import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Servidor falso do Salesforce, só para testes.
 *
 * HIPÓTESE: docs/fluxos-login.md marca como não confirmados o status HTTP e o corpo exatos
 * dos erros, inclusive com fluxo bloqueado, além da validade e do uso único do `code`.
 * Os erros abaixo seguem o padrão OAuth e são hipóteses até uma execução real (critério R4.3).
 */

export interface FakeUser {
  username: string;
  password: string;
  securityToken?: string;
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  query: string;
  form: URLSearchParams;
}

type Override = (res: ServerResponse, request: RecordedRequest) => void;

export interface FakeSalesforce {
  url: string;
  requests: RecordedRequest[];
  /** Resposta fixa para o caminho, no lugar do comportamento padrão. */
  overrides: Map<string, Override>;
  /** Caminho do site, devolvido no sfdc_community_url. */
  communityPath: string;
  /** Campos extras na resposta de token, como `expires_in`. */
  extraTokenFields: Record<string, unknown>;
  /** Faz o próximo code exigir outro verificador, simulando divergência de PKCE. */
  corruptNextChallenge: boolean;
  calls(suffix: string): RecordedRequest[];
  expireAllTokens(): void;
  close(): Promise<void>;
}

const CLIENT_ID = "CLIENTE-FALSO";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// HIPÓTESE: status e corpo exatos dos erros são não confirmados (fluxos-login.md, 2.6 e 3.4).
function sendOAuthError(res: ServerResponse, error: string, description: string): void {
  sendJson(res, 400, { error, error_description: description });
}

export async function startFakeSalesforce(
  options: { users?: FakeUser[]; clientSecret?: string } = {},
): Promise<FakeSalesforce> {
  const users = options.users ?? [];
  const codes = new Map<string, { challenge: string; redirectUri: string; username: string }>();
  const validTokens = new Set<string>();
  let sequence = 0;
  let server: Server | undefined;

  const fake: FakeSalesforce = {
    url: "",
    requests: [],
    overrides: new Map(),
    communityPath: "",
    extraTokenFields: {},
    corruptNextChallenge: false,
    calls: (suffix) => fake.requests.filter((request) => request.path.endsWith(suffix)),
    expireAllTokens: () => validTokens.clear(),
    close: () =>
      new Promise((resolve, reject) => {
        server?.closeAllConnections();
        server?.close((err) => (err ? reject(err) : resolve()));
      }),
  };

  function issueToken(res: ServerResponse, extra: Record<string, unknown>): void {
    sequence += 1;
    const token = `SENTINELA-TOKEN-${sequence}`;
    validTokens.add(token);
    // Como na documentação, a resposta não traz expires_in, a menos que o teste peça.
    sendJson(res, 200, {
      access_token: token,
      token_type: "Bearer",
      issued_at: "1700000000000",
      id: `${fake.url}/id/usuario`,
      signature: "assinatura-falsa",
      ...extra,
      ...fake.extraTokenFields,
    });
  }

  function handleAuthorize(res: ServerResponse, request: RecordedRequest): void {
    const { form, headers } = request;
    if (request.method !== "POST" || headers["auth-request-type"] !== "Named-User") {
      sendOAuthError(res, "invalid_request", "hipotese: requisicao de autorizacao invalida");
      return;
    }
    if (form.get("response_type") !== "code_credentials" || form.get("client_id") !== CLIENT_ID) {
      sendOAuthError(res, "invalid_client_id", "hipotese: client id invalido");
      return;
    }
    const user = users.find(
      (candidate) => candidate.username === form.get("login_hint") && candidate.password === form.get("password"),
    );
    if (!user) {
      sendOAuthError(res, "invalid_grant", "hipotese: credenciais invalidas");
      return;
    }
    sequence += 1;
    const code = `SENTINELA-CODIGO-${sequence}`;
    const redirectUri = form.get("redirect_uri") ?? "";
    const challenge = fake.corruptNextChallenge ? "desafio-divergente" : (form.get("code_challenge") ?? "");
    fake.corruptNextChallenge = false;
    codes.set(code, { challenge, redirectUri, username: user.username });

    const location = new URL(redirectUri);
    location.searchParams.set("code", code);
    location.searchParams.set("sfdc_community_url", `${fake.url}${fake.communityPath}`);
    location.searchParams.set("sfdc_community_id", "0DBFALSO");
    const state = form.get("state");
    if (state !== null) {
      location.searchParams.set("state", state);
    }
    res.writeHead(302, { Location: location.toString() });
    res.end();
  }

  function handleToken(res: ServerResponse, request: RecordedRequest): void {
    const { form } = request;
    if (request.method !== "POST") {
      sendOAuthError(res, "invalid_request", "hipotese: metodo nao suportado");
      return;
    }
    if (form.get("client_id") !== CLIENT_ID) {
      sendOAuthError(res, "invalid_client_id", "hipotese: client id invalido");
      return;
    }
    if (options.clientSecret !== undefined && form.get("client_secret") !== options.clientSecret) {
      sendOAuthError(res, "invalid_client", "hipotese: client secret invalido");
      return;
    }

    if (form.get("grant_type") === "authorization_code") {
      const code = form.get("code") ?? "";
      const stored = codes.get(code);
      // HIPÓTESE: uso único do code é não confirmado (fluxos-login.md, 2.4).
      codes.delete(code);
      if (!stored || stored.redirectUri !== form.get("redirect_uri")) {
        sendOAuthError(res, "invalid_grant", "hipotese: code invalido");
        return;
      }
      const verifier = form.get("code_verifier") ?? "";
      if (createHash("sha256").update(verifier).digest("base64url") !== stored.challenge) {
        sendOAuthError(res, "invalid_grant", "hipotese: code_verifier divergente ou ausente");
        return;
      }
      const community = `${fake.url}${fake.communityPath}`;
      issueToken(res, {
        instance_url: "https://instancia-que-nao-deve-ser-usada.invalid",
        sfdc_community_url: community,
        sfdc_community_id: "0DBFALSO",
        scope: "api",
      });
      return;
    }

    if (form.get("grant_type") === "password") {
      if (form.has("scope")) {
        sendOAuthError(res, "invalid_request", "hipotese: scope nao aceito neste fluxo");
        return;
      }
      const user = users.find(
        (candidate) =>
          candidate.username === form.get("username") &&
          `${candidate.password}${candidate.securityToken ?? ""}` === form.get("password"),
      );
      if (!user) {
        sendOAuthError(res, "invalid_grant", "authentication failure");
        return;
      }
      issueToken(res, { instance_url: `${fake.url}/` });
      return;
    }

    sendOAuthError(res, "unsupported_grant_type", "hipotese: grant_type nao suportado");
  }

  function handleUserinfo(res: ServerResponse, request: RecordedRequest): void {
    const token = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
    if (!validTokens.has(token)) {
      sendJson(res, 401, [{ message: "Session expired or invalid", errorCode: "INVALID_SESSION_ID" }]);
      return;
    }
    sendJson(res, 200, { sub: "usuario-falso" });
  }

  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const request: RecordedRequest = {
        method: req.method ?? "",
        path: url.pathname,
        headers: req.headers,
        query: url.search,
        form: new URLSearchParams(Buffer.concat(chunks).toString("utf8")),
      };
      fake.requests.push(request);

      const override = [...fake.overrides].find(([suffix]) => url.pathname.endsWith(suffix))?.[1];
      if (override) {
        override(res, request);
      } else if (url.pathname.endsWith("/services/oauth2/authorize")) {
        handleAuthorize(res, request);
      } else if (url.pathname.endsWith("/services/oauth2/token")) {
        handleToken(res, request);
      } else if (url.pathname.endsWith("/services/oauth2/userinfo")) {
        handleUserinfo(res, request);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });

  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return fake;
}

export const FAKE_CLIENT_ID = CLIENT_ID;
