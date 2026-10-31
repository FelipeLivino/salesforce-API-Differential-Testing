import { issuedTokensInJson, maskOutput, redact, secretsInJson } from "../log/redact";
import type { LoginFailure, LoginResult, LoginSuccess } from "./types";

export const DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_RESPONSE_BYTES = 1024 * 1024;

export interface AdapterOptions {
  timeoutMs?: number;
}

type Secrets = ReadonlyArray<string | undefined>;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Devolve o motivo da recusa, ou null se a URL pode receber credenciais. Nunca repete a URL. */
export function urlProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "não é uma URL válida";
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))) {
    return "precisa usar https (http só em loopback)";
  }
  if (url.username !== "" || url.password !== "") {
    return "não pode conter credenciais";
  }
  if (url.search !== "" || url.hash !== "") {
    return "não pode conter query string ou fragmento";
  }
  return null;
}

const SALESFORCE_HOST_SUFFIXES = [".salesforce.com", ".force.com", ".site.com"];

/**
 * Destino de credenciais e do token, vindo do servidor: `sfdc_community_url` e `instance_url`.
 * Vale a mesma origem da URL do contexto, ou https em domínio da Salesforce, com loopback só se o
 * contexto também for loopback. A URL que repete um segredo é recusada, pois voltaria à tela.
 */
export function tokenDestinationProblem(value: string, loginUrl: string, secrets: Secrets = []): string | null {
  const problem = urlProblem(value);
  if (problem !== null) {
    return problem;
  }
  if (redact(value, secrets) !== value) {
    return "contém um valor sensível";
  }
  const url = new URL(value);
  const login = new URL(loginUrl);
  if (url.origin === login.origin) {
    return null;
  }
  if (LOOPBACK_HOSTS.has(url.hostname)) {
    return LOOPBACK_HOSTS.has(login.hostname) ? null : "endereço local só é aceito se a URL do contexto também for local";
  }
  const hasEmptyLabel = url.hostname.split(".").includes("");
  if (url.protocol === "https:" && !hasEmptyLabel && SALESFORCE_HOST_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix))) {
    return null;
  }
  return `precisa ter a mesma origem da URL do contexto ou usar https em host terminado em ${SALESFORCE_HOST_SUFFIXES.join(", ")}`;
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

export function configFailure(message: string): LoginFailure {
  return { ok: false, kind: "configuracao", message };
}

export interface HttpResponse {
  status: number;
  location: string | null;
  body: string;
}

function networkFailure(err: unknown, step: string): LoginFailure {
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError") {
    return { ok: false, kind: "rede", step, message: "Sem resposta do servidor dentro do tempo limite." };
  }
  if (name === "AbortError") {
    return { ok: false, kind: "rede", step, message: "A chamada foi cancelada." };
  }
  // Só o código do sistema: a mensagem original não entra no retorno.
  const code = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  const suffix = typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? ` (${code})` : "";
  return { ok: false, kind: "rede", step, message: `Falha de conexão com o servidor${suffix}.` };
}

/** Lê no máximo MAX_RESPONSE_BYTES e, ao ultrapassar, aborta a conexão sem ler o restante. */
async function readResponse(response: Response, step: string): Promise<HttpResponse | LoginFailure> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return {
          ok: false,
          kind: "salesforce",
          step,
          httpStatus: response.status,
          message: "A resposta do servidor ultrapassou o limite de 1 MB e a leitura foi abortada.",
        };
      }
      chunks.push(value);
    }
  }
  return {
    status: response.status,
    location: response.headers.get("location"),
    body: Buffer.concat(chunks).toString("utf8"),
  };
}

/** POST de formulário, sem seguir redirecionamentos. Falha de rede vira LoginFailure. */
export async function postForm(
  url: string,
  params: URLSearchParams,
  options: { step: string; timeoutMs: number; headers?: Record<string, string>; signal?: AbortSignal },
): Promise<HttpResponse | LoginFailure> {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...options.headers },
      body: params,
      redirect: "manual",
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
    return await readResponse(response, options.step);
  } catch (err) {
    return networkFailure(err, options.step);
  }
}

/** GET com o token, sem seguir redirecionamentos. Falha de rede vira LoginFailure. */
export async function getWithBearer(
  url: string,
  accessToken: string,
  options: { step: string; timeoutMs: number; signal?: AbortSignal },
): Promise<HttpResponse | LoginFailure> {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: "manual",
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
    return await readResponse(response, options.step);
  } catch (err) {
    return networkFailure(err, options.step);
  }
}

export function isFailure(value: HttpResponse | LoginFailure): value is LoginFailure {
  return "ok" in value;
}

export function parseJsonObject(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Monta a falha com `error` e `error_description` reais, alterando só segredos. */
export function salesforceFailure(
  step: string,
  status: number,
  raw: string,
  fields: { error?: unknown; errorDescription?: unknown },
  secrets: Secrets,
  message?: string,
): LoginFailure {
  return maskOutput<LoginFailure>(
    {
      ok: false,
      kind: "salesforce",
      step,
      httpStatus: status,
      ...(typeof fields.error === "string" ? { error: fields.error } : {}),
      ...(typeof fields.errorDescription === "string" ? { errorDescription: fields.errorDescription } : {}),
      ...(raw !== "" ? { rawBody: raw } : {}),
      ...(message !== undefined ? { message } : {}),
    },
    secrets,
  );
}

/**
 * Quais valores da própria resposta viram segredos conhecidos (decisão S12). Em resposta de erro,
 * nenhum: o campo é mascarado pela estrutura, sem esconder a mesma palavra no resto do erro.
 */
function secretsInFailureBody(status: number, json: Record<string, unknown> | null): string[] {
  if (json === null || status < 200 || status >= 300) {
    return [];
  }
  return "error" in json ? issuedTokensInJson(json) : secretsInJson(json);
}

/** Falha a partir do corpo da resposta. `message` só é usada se não houver campo `error`. */
export function failureFromBody(
  step: string,
  response: HttpResponse,
  secrets: Secrets,
  message: string,
): LoginFailure {
  const json = parseJsonObject(response.body);
  const hasError = typeof json?.error === "string";
  return salesforceFailure(
    step,
    response.status,
    response.body,
    { error: json?.error, errorDescription: json?.error_description },
    // Os tokens da própria resposta entram antes de redigir o restante dela.
    [...secrets, ...secretsInFailureBody(response.status, json)],
    hasError ? undefined : message,
  );
}

export type TokenJson = Record<string, unknown> & { access_token: string };

/** Valida a resposta do endpoint de token, sem presumir nenhum campo além do access_token. */
export function readTokenResponse(
  step: string,
  response: HttpResponse,
  secrets: Secrets,
): TokenJson | LoginFailure {
  const isSuccessStatus = response.status >= 200 && response.status < 300;
  const json = isSuccessStatus ? parseJsonObject(response.body) : null;
  if (!isSuccessStatus || json === null || "error" in json) {
    return failureFromBody(step, response, secrets, "O servidor não devolveu um token em JSON válido.");
  }
  if (typeof json.access_token !== "string" || json.access_token === "") {
    return failureFromBody(step, response, secrets, "A resposta do servidor não contém access_token.");
  }
  return json as TokenJson;
}

function parseIssuedAt(value: unknown, now: Date): Date {
  // A documentação traz issued_at como texto em milissegundos; se não vier assim, vale o relógio local.
  const millis = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof millis === "number" && Number.isFinite(millis) && millis > 0 ? new Date(millis) : now;
}

function parseExpiresIn(value: unknown): number | null {
  const seconds = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/** Monta o sucesso. Sem `expires_in` válido, não há data estimada: o token vale até receber 401. */
export function buildSuccess(
  step: string,
  response: HttpResponse,
  json: TokenJson,
  destination: { name: string; value: unknown; loginUrl: string },
  secrets: Secrets,
): LoginResult {
  const maskValues = secretsInJson(json);
  const known = [...secrets, ...maskValues];
  const { name, value: baseUrl, loginUrl } = destination;
  const problem = typeof baseUrl === "string" ? tokenDestinationProblem(baseUrl, loginUrl, known) : "está ausente";
  if (problem !== null || typeof baseUrl !== "string") {
    return salesforceFailure(
      step,
      response.status,
      response.body,
      {},
      known,
      `O ${name} devolvido pelo servidor foi recusado: ${problem}. O token não foi usado.`,
    );
  }
  const now = new Date();
  const expiresIn = parseExpiresIn(json.expires_in);
  const success: LoginSuccess = {
    ok: true,
    accessToken: json.access_token,
    instanceUrl: baseUrl,
    issuedAt: parseIssuedAt(json.issued_at, now),
    expiresAt: expiresIn === null ? null : new Date(now.getTime() + expiresIn * 1000),
    expiresAtSource: expiresIn === null ? "nao-informado" : "salesforce",
    maskValues,
  };
  return success;
}
