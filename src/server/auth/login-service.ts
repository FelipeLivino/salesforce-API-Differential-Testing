import { decryptSecret, SecretsCryptoError } from "../crypto/secrets";
import type { AmbientesRepository, ContextosRepository, PerfisRepository } from "../db/repositories";
import { maskOutput } from "../log/redact";
import { configFailure } from "./oauth-http";
import { loginRegistry, type LoginRegistry } from "./registry";
import { getTokenCache, type TokenCache, type TokenCallResult } from "./token-cache";
import type { LoginFailure, LoginInput, LoginResult, LoginSuccess } from "./types";
import { USERINFO_PATH, validateToken } from "./userinfo";

export interface LoginServiceDeps {
  contextos: Pick<ContextosRepository, "buscarPorId">;
  ambientes: Pick<AmbientesRepository, "buscarPorId">;
  perfis: Pick<PerfisRepository, "buscarPorId">;
  /** Padrão: o registro da aplicação. */
  registry?: LoginRegistry;
  /** Padrão: getTokenCache(). */
  tokens?: TokenCache;
  userinfoTimeoutMs?: number;
}

/** Sem token: é o que pode sair de `src/server`. */
export interface LoginTestSuccess {
  ok: true;
  instanceUrl: string;
  expiresAt: Date | null;
  expiresAtSource: LoginSuccess["expiresAtSource"];
  userinfo: { endpoint: string; httpStatus: number };
}

export type LoginTestResult = LoginTestSuccess | LoginFailure;

export type LoginService = ReturnType<typeof createLoginService>;

export function createLoginService(deps: LoginServiceDeps) {
  const registry = deps.registry ?? loginRegistry;
  const tokens = deps.tokens ?? getTokenCache();

  /** Lê o banco só na hora do login: depois de uma edição, vale sempre o dado atual. */
  async function login(contextoId: number): Promise<LoginResult> {
    const contexto = deps.contextos.buscarPorId(contextoId);
    if (!contexto) {
      return configFailure("Contexto não encontrado.");
    }
    const ambiente = deps.ambientes.buscarPorId(contexto.ambienteId);
    const perfil = deps.perfis.buscarPorId(contexto.perfilId);
    if (!ambiente || !perfil) {
      return configFailure("O contexto aponta para um ambiente ou perfil que não existe.");
    }
    const adapter = registry.get(perfil.tipoLogin);
    if (!adapter) {
      return configFailure("O tipo de login do perfil não tem adaptador registrado.");
    }

    let input: LoginInput;
    try {
      const { clientSecretCifrado, clientId, redirectUri } = ambiente.app;
      input = {
        loginUrl: contexto.url,
        clientId,
        username: contexto.login,
        password: decryptSecret(contexto.senhaCifrada),
        ...(clientSecretCifrado !== null && { clientSecret: decryptSecret(clientSecretCifrado) }),
        ...(redirectUri !== null && { redirectUri }),
        ...(contexto.securityTokenCifrado !== null && {
          securityToken: decryptSecret(contexto.securityTokenCifrado),
        }),
      };
    } catch (error) {
      // A mensagem desse erro é fixa e não carrega segredo, chave ou valor cifrado.
      if (error instanceof SecretsCryptoError) {
        return configFailure(error.message);
      }
      throw error;
    }
    const cached = tokens.get(String(contextoId))?.accessToken;
    // O servidor também pode repetir em um erro o token em cache, que o adaptador só conhece por aqui.
    const result = await adapter.login(cached ? { ...input, maskValues: [cached] } : input);
    return result.ok ? result : maskOutput(result, [input.password, input.clientSecret, input.securityToken, cached]);
  }

  /** Segredos do contexto para mascarar respostas. Se algum não decifrar, não há login nem o que mascarar. */
  function knownSecrets(contextoId: number): string[] {
    const contexto = deps.contextos.buscarPorId(contextoId);
    const ambiente = contexto && deps.ambientes.buscarPorId(contexto.ambienteId);
    const cifrados = [contexto?.senhaCifrada, contexto?.securityTokenCifrado, ambiente?.app.clientSecretCifrado];
    return cifrados.flatMap((cifrado) => {
      if (!cifrado) return [];
      try {
        return [decryptSecret(cifrado)];
      } catch (error) {
        if (error instanceof SecretsCryptoError) return [];
        throw error;
      }
    });
  }

  function getToken(contextoId: number, options: { forceRefresh?: boolean } = {}): Promise<LoginResult> {
    return tokens.getOrLogin(String(contextoId), () => login(contextoId), options);
  }

  return {
    /** Porta de entrada do token. `forceRefresh` ignora o cache e grava o token novo se der certo. */
    getToken,

    /** Chamada com o token: em caso de 401, um único novo login e uma única repetição (decisão 9). */
    async callWithToken<T>(
      contextoId: number,
      call: (token: LoginSuccess) => Promise<T>,
      isUnauthorized: (result: T) => boolean,
    ): Promise<TokenCallResult<T>> {
      // O token recusado sai do cache antes do novo login, mas continua sendo segredo.
      const used = new Set<string>();
      const result = await tokens.callWithToken(
        String(contextoId),
        () => login(contextoId),
        (token) => {
          for (const value of [token.accessToken, ...(token.maskValues ?? [])]) {
            used.add(value);
          }
          return call(token);
        },
        isUnauthorized,
      );
      return result.ok ? result : maskOutput(result, [...used]);
    },

    /**
     * Testar login: sempre autentica de novo (decisão 6) e confirma o token. Um 401 aqui é o
     * resultado do teste, sem novo login, mas o token recusado sai do cache.
     */
    async testLogin(contextoId: number): Promise<LoginTestResult> {
      // Lido antes do novo login, que substitui o token em cache.
      const cached = tokens.get(String(contextoId))?.accessToken;
      const token = await getToken(contextoId, { forceRefresh: true });
      const secrets = [...knownSecrets(contextoId), cached];
      if (!token.ok) {
        return maskOutput(token, secrets);
      }
      const tokenSecrets = [...secrets, token.accessToken, ...(token.maskValues ?? [])];
      const validation = await validateToken(
        token,
        tokenSecrets,
        deps.userinfoTimeoutMs === undefined ? {} : { timeoutMs: deps.userinfoTimeoutMs },
      );
      if (!validation.ok) {
        if (validation.httpStatus === 401) {
          tokens.invalidate(String(contextoId));
        }
        return maskOutput(validation, tokenSecrets);
      }
      return maskOutput<LoginTestSuccess>(
        {
          ok: true,
          instanceUrl: token.instanceUrl,
          expiresAt: token.expiresAt,
          expiresAtSource: token.expiresAtSource,
          userinfo: { endpoint: USERINFO_PATH, httpStatus: validation.httpStatus },
        },
        tokenSecrets,
      );
    },
  };
}
