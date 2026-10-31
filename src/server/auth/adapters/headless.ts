import { createHash, randomBytes } from "node:crypto";
import {
  type AdapterOptions,
  buildSuccess,
  configFailure,
  DEFAULT_TIMEOUT_MS,
  failureFromBody,
  type HttpResponse,
  isFailure,
  joinUrl,
  postForm,
  readTokenResponse,
  salesforceFailure,
  tokenDestinationProblem,
  urlProblem,
} from "../oauth-http";
import { secretsInJson } from "../../log/redact";
import type { LoginAdapter, LoginFailure, LoginInput, LoginResult } from "../types";

type Secrets = ReadonlyArray<string | undefined>;

interface AuthorizeGrant {
  code: string;
  communityUrl: string;
}

/** Lê o 302 do passo authorize: o redirect nunca é seguido, só seus parâmetros são usados. */
function readAuthorizeResponse(
  response: HttpResponse,
  authorizeUrl: string,
  loginUrl: string,
  state: string,
  secrets: Secrets,
): AuthorizeGrant | LoginFailure {
  const step = "authorize";
  const isRedirect = response.status >= 300 && response.status < 400;
  if (!isRedirect || response.location === null) {
    return failureFromBody(step, response, secrets, "O servidor não devolveu o redirecionamento esperado.");
  }

  let known = secrets;
  const fail = (message?: string, fields: { error?: unknown; errorDescription?: unknown } = {}) =>
    salesforceFailure(step, response.status, response.location ?? "", fields, known, message);

  let params: URLSearchParams;
  try {
    params = new URL(response.location, authorizeUrl).searchParams;
  } catch {
    return fail("O redirecionamento devolvido pelo servidor é inválido.");
  }

  const code = params.get("code");
  const error = params.get("error");
  if (error !== null) {
    // Redirect de erro: os parâmetros são mascarados pelo nome, sem virar segredos globais (decisão S12).
    return fail(undefined, { error, errorDescription: params.get("error_description") ?? undefined });
  }
  // O servidor pode repetir o code ou um token em outro parâmetro do mesmo redirect.
  known = [...secrets, code ?? undefined, ...secretsInJson(Object.fromEntries(params))];
  if (params.get("state") !== state) {
    return fail("O state devolvido pelo servidor não confere com o enviado.");
  }
  const communityUrl = params.get("sfdc_community_url");
  if (!code || !communityUrl) {
    return fail("O redirecionamento não contém code e sfdc_community_url.");
  }
  // O próximo passo envia code, verificador e secret a este host, por isso ele é validado antes.
  const problem = tokenDestinationProblem(communityUrl, loginUrl, known);
  if (problem !== null) {
    return fail(`O sfdc_community_url devolvido pelo servidor foi recusado: ${problem}.`);
  }
  return { code, communityUrl };
}

/**
 * Headless Login da comunidade: Authorization Code and Credentials com PKCE
 * (docs/fluxos-login.md, seção 2). Comunidade nunca usa o OAuth antigo.
 */
export function createHeadlessAdapter(options: AdapterOptions = {}): LoginAdapter {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    type: "headless",

    async login(input: LoginInput, signal?: AbortSignal): Promise<LoginResult> {
      const missing = [
        input.loginUrl === "" && "URL",
        input.clientId === "" && "Client ID",
        !input.redirectUri && "redirect URI",
        input.username === "" && "login",
        input.password === "" && "senha",
      ].filter(Boolean);
      if (missing.length > 0 || !input.redirectUri) {
        return configFailure(`Campos obrigatórios ausentes: ${missing.join(", ")}.`);
      }
      const problem = urlProblem(input.loginUrl);
      if (problem !== null) {
        return configFailure(`A URL do contexto ${problem}.`);
      }

      const signalOption = signal ? { signal } : {};
      // Regras do code_verifier são não confirmadas; 32 bytes geram 43 caracteres, o mínimo da RFC 7636.
      const codeVerifier = randomBytes(32).toString("base64url");
      const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
      const state = randomBytes(16).toString("base64url");
      const secrets: Secrets = [
        input.password,
        input.clientSecret,
        input.securityToken,
        codeVerifier,
        ...(input.maskValues ?? []),
      ];

      const authorizeUrl = joinUrl(input.loginUrl, "/services/oauth2/authorize");
      // Credenciais no corpo, não em Basic: é o único formato aceito por apps com
      // "Require user credentials in the POST body". Validar na primeira execução real (R4.3).
      const authorizeResponse = await postForm(
        authorizeUrl,
        new URLSearchParams({
          response_type: "code_credentials",
          client_id: input.clientId,
          redirect_uri: input.redirectUri,
          code_challenge: codeChallenge,
          state,
          login_hint: input.username,
          password: input.password,
        }),
        { step: "authorize", timeoutMs, headers: { "Auth-Request-Type": "Named-User" }, ...signalOption },
      );
      if (isFailure(authorizeResponse)) {
        return authorizeResponse;
      }
      const grant = readAuthorizeResponse(authorizeResponse, authorizeUrl, input.loginUrl, state, secrets);
      if ("ok" in grant) {
        return grant;
      }

      const tokenSecrets = [...secrets, grant.code];
      const tokenParams = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: input.clientId,
        code: grant.code,
        redirect_uri: input.redirectUri,
        code_verifier: codeVerifier,
      });
      if (input.clientSecret) {
        tokenParams.set("client_secret", input.clientSecret);
      }
      const tokenResponse = await postForm(joinUrl(grant.communityUrl, "/services/oauth2/token"), tokenParams, {
        step: "token",
        timeoutMs,
        ...signalOption,
      });
      if (isFailure(tokenResponse)) {
        return tokenResponse;
      }
      const json = readTokenResponse("token", tokenResponse, tokenSecrets);
      if ("ok" in json) {
        return json as LoginFailure;
      }
      // A URL base do Headless é o sfdc_community_url, não o instance_url (fluxos-login.md, 4.1).
      const destination = {
        name: "sfdc_community_url",
        value: json.sfdc_community_url ?? grant.communityUrl,
        loginUrl: input.loginUrl,
      };
      const result = buildSuccess("token", tokenResponse, json, destination, tokenSecrets);
      return result.ok ? { ...result, maskValues: [...(result.maskValues ?? []), grant.code, codeVerifier] } : result;
    },
  };
}

export const headlessAdapter = createHeadlessAdapter();
