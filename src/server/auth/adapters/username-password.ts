import {
  type AdapterOptions,
  buildSuccess,
  configFailure,
  DEFAULT_TIMEOUT_MS,
  isFailure,
  joinUrl,
  postForm,
  readTokenResponse,
  urlProblem,
} from "../oauth-http";
import type { LoginAdapter, LoginInput, LoginResult } from "../types";

const STEP = "token";

/**
 * OAuth Username-Password do usuário de integração (docs/fluxos-login.md, seção 3).
 * O fluxo tem aposentadoria anunciada para 20/02/2027: nada fora deste arquivo pode depender dele.
 */
export function createUsernamePasswordAdapter(options: AdapterOptions = {}): LoginAdapter {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    type: "username-password",

    async login(input: LoginInput, signal?: AbortSignal): Promise<LoginResult> {
      const missing = [
        input.loginUrl === "" && "URL",
        input.clientId === "" && "Client ID",
        input.username === "" && "login",
        input.password === "" && "senha",
      ].filter(Boolean);
      if (missing.length > 0) {
        return configFailure(`Campos obrigatórios ausentes: ${missing.join(", ")}.`);
      }
      const problem = urlProblem(input.loginUrl);
      if (problem !== null) {
        return configFailure(`A URL do contexto ${problem}.`);
      }

      const secrets = [input.password, input.clientSecret, input.securityToken, ...(input.maskValues ?? [])];
      // O security token não tem parâmetro próprio: vai concatenado ao final da senha.
      const params = new URLSearchParams({
        grant_type: "password",
        client_id: input.clientId,
        username: input.username,
        password: `${input.password}${input.securityToken ?? ""}`,
      });
      // A dispensa do client_secret neste fluxo é não confirmada: se faltar, vale o erro real.
      if (input.clientSecret) {
        params.set("client_secret", input.clientSecret);
      }

      const response = await postForm(joinUrl(input.loginUrl, "/services/oauth2/token"), params, {
        step: STEP,
        timeoutMs,
        ...(signal ? { signal } : {}),
      });
      if (isFailure(response)) {
        return response;
      }
      const json = readTokenResponse(STEP, response, secrets);
      if ("ok" in json) {
        return json as Extract<LoginResult, { ok: false }>;
      }
      // O token iria a esta URL no passo seguinte: vale a mesma regra de destino do Headless.
      const destination = { name: "instance_url", value: json.instance_url, loginUrl: input.loginUrl };
      return buildSuccess(STEP, response, json, destination, secrets);
    },
  };
}

export const usernamePasswordAdapter = createUsernamePasswordAdapter();
