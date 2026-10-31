import {
  DEFAULT_TIMEOUT_MS,
  failureFromBody,
  getWithBearer,
  isFailure,
  joinUrl,
  parseJsonObject,
} from "./oauth-http";
import type { LoginFailure, LoginSuccess } from "./types";

export const USERINFO_PATH = "/services/oauth2/userinfo";
const STEP = "userinfo";

export type TokenValidation = { ok: true; httpStatus: number } | LoginFailure;

/**
 * Confirma o token com a chamada usada pela documentação (fluxos-login.md, 2.5). Só o status
 * interessa: os dados do usuário não saem daqui. O redirect não é seguido, para o token não
 * ser enviado a outro host.
 */
export async function validateToken(
  token: LoginSuccess,
  secrets: ReadonlyArray<string | undefined>,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<TokenValidation> {
  const response = await getWithBearer(joinUrl(token.instanceUrl, USERINFO_PATH), token.accessToken, {
    step: STEP,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (isFailure(response)) {
    return response;
  }
  const allSecrets = [...secrets, token.accessToken, ...(token.maskValues ?? [])];
  if (response.status < 200 || response.status >= 300) {
    return failureFromBody(STEP, response, allSecrets, `O servidor recusou o token em ${USERINFO_PATH}.`);
  }
  const json = parseJsonObject(response.body);
  if (json === null || "error" in json) {
    return failureFromBody(STEP, response, allSecrets, `A resposta de ${USERINFO_PATH} não é um JSON válido.`);
  }
  return { ok: true, httpStatus: response.status };
}
