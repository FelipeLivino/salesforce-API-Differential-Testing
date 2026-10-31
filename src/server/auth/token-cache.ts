import type { LoginFailure, LoginResult, LoginSuccess } from "./types";

/** Margem aplicada só quando o Salesforce informa `expires_in`. */
const EXPIRY_MARGIN_MS = 60_000;

export type LoginFn = () => Promise<LoginResult>;

export type TokenCallResult<T> = { ok: true; value: T } | LoginFailure;

export interface TokenCache {
  get(contextoId: string): LoginSuccess | undefined;
  set(contextoId: string, token: LoginSuccess): void;
  invalidate(contextoId: string): void;
  invalidateAll(): void;
  /** Devolve o token em cache ou faz um login, sem login simultâneo do mesmo contexto. */
  getOrLogin(contextoId: string, login: LoginFn, options?: { forceRefresh?: boolean }): Promise<LoginResult>;
  /**
   * Executa `call` com o token. Em caso de 401, faz um único novo login e repete a
   * chamada uma única vez. Um segundo 401 é devolvido a quem chamou, sem novo login.
   */
  callWithToken<T>(
    contextoId: string,
    login: LoginFn,
    call: (token: LoginSuccess) => Promise<T>,
    isUnauthorized: (result: T) => boolean,
  ): Promise<TokenCallResult<T>>;
}

interface InFlightLogin {
  promise: Promise<LoginResult>;
  /** O contexto foi invalidado durante o login: o resultado não pode entrar no cache. */
  stale: boolean;
}

export function createTokenCache(options: { now?: () => number } = {}): TokenCache {
  const now = options.now ?? Date.now;
  const tokens = new Map<string, LoginSuccess>();
  const inFlight = new Map<string, InFlightLogin>();

  const cache: TokenCache = {
    get(contextoId) {
      const token = tokens.get(contextoId);
      if (token?.expiresAt && now() >= token.expiresAt.getTime() - EXPIRY_MARGIN_MS) {
        tokens.delete(contextoId);
        return undefined;
      }
      return token;
    },

    set(contextoId, token) {
      tokens.set(contextoId, token);
    },

    invalidate(contextoId) {
      tokens.delete(contextoId);
      const running = inFlight.get(contextoId);
      if (running) {
        running.stale = true;
      }
    },

    invalidateAll() {
      tokens.clear();
      for (const running of inFlight.values()) {
        running.stale = true;
      }
    },

    async getOrLogin(contextoId, login, { forceRefresh = false } = {}) {
      for (;;) {
        const running = inFlight.get(contextoId);
        if (!running) {
          break;
        }
        if (!running.stale) {
          return running.promise;
        }
        // Login de dados antigos ainda em curso: espera acabar para não haver dois ao mesmo tempo.
        await running.promise.catch(() => undefined);
      }
      if (!forceRefresh) {
        const cached = cache.get(contextoId);
        if (cached) {
          return cached;
        }
      }
      return startLogin(contextoId, login);
    },

    async callWithToken(contextoId, login, call, isUnauthorized) {
      const token = await cache.getOrLogin(contextoId, login);
      if (!token.ok) {
        return token;
      }
      const first = await call(token);
      if (!isUnauthorized(first)) {
        return { ok: true, value: first };
      }

      // Outra chamada pode já ter renovado o token: só o token rejeitado sai do cache.
      discardIfCurrent(contextoId, token);
      const renewed = await cache.getOrLogin(contextoId, login);
      if (!renewed.ok) {
        return renewed;
      }
      const second = await call(renewed);
      if (isUnauthorized(second)) {
        discardIfCurrent(contextoId, renewed);
      }
      return { ok: true, value: second };
    },
  };

  function discardIfCurrent(contextoId: string, rejected: LoginSuccess): void {
    if (tokens.get(contextoId)?.accessToken === rejected.accessToken) {
      tokens.delete(contextoId);
    }
  }

  function startLogin(contextoId: string, login: LoginFn): Promise<LoginResult> {
    const entry: InFlightLogin = {
      stale: false,
      // Começa no próximo microtask para que `entry` já esteja no mapa quando o login terminar.
      promise: Promise.resolve()
        .then(login)
        .then((result) => {
          if (result.ok && !entry.stale) {
            tokens.set(contextoId, result);
          }
          return result;
        })
        .finally(() => {
          inFlight.delete(contextoId);
        }),
    };
    inFlight.set(contextoId, entry);
    return entry.promise;
  }

  return cache;
}

const GLOBAL_KEY = Symbol.for("salesforce-api-differential-testing.token-cache");
const globalStore = globalThis as unknown as Record<symbol, TokenCache | undefined>;

/** Instância única em globalThis, para sobreviver a bundles separados e ao hot reload. */
export function getTokenCache(): TokenCache {
  return (globalStore[GLOBAL_KEY] ??= createTokenCache());
}
