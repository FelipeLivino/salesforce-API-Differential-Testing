import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_CLIENT_ID, type FakeSalesforce, startFakeSalesforce } from "../../../tests/fake-salesforce/server";
import { createUsernamePasswordAdapter } from "./adapters/username-password";
import { createTokenCache, getTokenCache, type LoginFn } from "./token-cache";
import type { LoginFailure, LoginSuccess } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

function token(accessToken: string, expiresAt: Date | null = null): LoginSuccess {
  return {
    ok: true,
    accessToken,
    instanceUrl: "https://fake.invalid",
    issuedAt: new Date(0),
    expiresAt,
    expiresAtSource: expiresAt ? "salesforce" : "nao-informado",
  };
}

const failure: LoginFailure = { ok: false, kind: "salesforce", error: "invalid_grant" };

/** Login que devolve TOKEN-1, TOKEN-2... */
function sequentialLogin() {
  let count = 0;
  return vi.fn<LoginFn>(async () => token(`TOKEN-${++count}`));
}

/** Login que só termina quando o teste mandar. */
function controlledLogin() {
  const pending: Array<() => void> = [];
  let count = 0;
  const fn = vi.fn<LoginFn>(
    () =>
      new Promise((resolve) => {
        const value = token(`TOKEN-${++count}`);
        pending.push(() => resolve(value));
      }),
  );
  return { fn, release: () => pending.shift()?.() };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

interface Response {
  status: number;
  token: string;
}

const is401 = (result: Response) => result.status === 401;

describe("cache de tokens", () => {
  it("reaproveita o token do mesmo contexto", async () => {
    const cache = createTokenCache();
    const login = sequentialLogin();

    await cache.getOrLogin("c1", login);
    const second = (await cache.getOrLogin("c1", login)) as LoginSuccess;

    expect(login).toHaveBeenCalledTimes(1);
    expect(second.accessToken).toBe("TOKEN-1");
  });

  it("não compartilha token entre contextos", async () => {
    const cache = createTokenCache();
    const login = sequentialLogin();

    const a = (await cache.getOrLogin("c1", login)) as LoginSuccess;
    const b = (await cache.getOrLogin("c2", login)) as LoginSuccess;

    expect(a.accessToken).not.toBe(b.accessToken);
    expect(login).toHaveBeenCalledTimes(2);
  });

  it("sem expires_in, não expira por tempo", async () => {
    let now = 0;
    const cache = createTokenCache({ now: () => now });
    const login = sequentialLogin();

    await cache.getOrLogin("c1", login);
    now = 365 * DAY_MS;
    await cache.getOrLogin("c1", login);

    expect(login).toHaveBeenCalledTimes(1);
  });

  it("com expires_in, respeita a margem de 60s e remove o item vencido na leitura", () => {
    let now = 0;
    const cache = createTokenCache({ now: () => now });
    cache.set("c1", token("TOKEN", new Date(120_000)));

    now = 59_999;
    expect(cache.get("c1")?.accessToken).toBe("TOKEN");
    now = 60_000;
    expect(cache.get("c1")).toBeUndefined();
    now = 0;
    expect(cache.get("c1")).toBeUndefined();
  });

  it("não guarda falhas, e a tentativa seguinte faz novo login", async () => {
    const cache = createTokenCache();
    const login = vi.fn<LoginFn>().mockResolvedValueOnce(failure).mockResolvedValueOnce(token("TOKEN"));

    expect((await cache.getOrLogin("c1", login)).ok).toBe(false);
    expect(cache.get("c1")).toBeUndefined();
    expect((await cache.getOrLogin("c1", login)).ok).toBe(true);
  });

  it("forceRefresh faz novo login e grava o token novo", async () => {
    const cache = createTokenCache();
    const login = sequentialLogin();

    await cache.getOrLogin("c1", login);
    await cache.getOrLogin("c1", login, { forceRefresh: true });

    expect(login).toHaveBeenCalledTimes(2);
    expect(cache.get("c1")?.accessToken).toBe("TOKEN-2");
  });

  it("forceRefresh com falha mantém o token anterior", async () => {
    const cache = createTokenCache();
    cache.set("c1", token("ANTIGO"));

    const result = await cache.getOrLogin("c1", async () => failure, { forceRefresh: true });

    expect(result.ok).toBe(false);
    expect(cache.get("c1")?.accessToken).toBe("ANTIGO");
  });

  it("invalidate e invalidateAll obrigam novo login", async () => {
    const cache = createTokenCache();
    const login = sequentialLogin();

    await cache.getOrLogin("c1", login);
    cache.invalidate("c1");
    await cache.getOrLogin("c1", login);
    await cache.getOrLogin("c2", login);
    cache.invalidateAll();
    await cache.getOrLogin("c1", login);
    await cache.getOrLogin("c2", login);

    expect(login).toHaveBeenCalledTimes(5);
  });

  it("mantém instância única em globalThis", () => {
    expect(getTokenCache()).toBe(getTokenCache());
  });

  describe("concorrência", () => {
    it("chamadas simultâneas do mesmo contexto compartilham um único login", async () => {
      const cache = createTokenCache();
      const { fn, release } = controlledLogin();

      const calls = [cache.getOrLogin("c1", fn), cache.getOrLogin("c1", fn), cache.getOrLogin("c1", fn)];
      await flush();
      release();
      const results = (await Promise.all(calls)) as LoginSuccess[];

      expect(fn).toHaveBeenCalledTimes(1);
      expect(new Set(results.map((result) => result.accessToken)).size).toBe(1);
    });

    it("forceRefresh durante um login em curso não inicia outro", async () => {
      const cache = createTokenCache();
      const { fn, release } = controlledLogin();

      const first = cache.getOrLogin("c1", fn);
      const forced = cache.getOrLogin("c1", fn, { forceRefresh: true });
      await flush();
      release();
      await Promise.all([first, forced]);

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("contextos diferentes logam em paralelo", async () => {
      const cache = createTokenCache();
      const { fn, release } = controlledLogin();

      const calls = [cache.getOrLogin("c1", fn), cache.getOrLogin("c2", fn)];
      await flush();

      expect(fn).toHaveBeenCalledTimes(2);
      release();
      release();
      await Promise.all(calls);
    });

    it("login que lança exceção libera o contexto para nova tentativa", async () => {
      const cache = createTokenCache();
      const login = vi
        .fn<LoginFn>()
        .mockImplementationOnce(() => {
          throw new Error("defeito");
        })
        .mockResolvedValueOnce(token("TOKEN"));

      await expect(cache.getOrLogin("c1", login)).rejects.toThrow("defeito");
      expect((await cache.getOrLogin("c1", login)).ok).toBe(true);
    });

    it("token de login iniciado antes da invalidação não entra no cache", async () => {
      const cache = createTokenCache();
      const { fn, release } = controlledLogin();

      const running = cache.getOrLogin("c1", fn);
      await flush();
      cache.invalidate("c1");
      release();
      await running;

      expect(cache.get("c1")).toBeUndefined();
    });

    it("após invalidar, o novo login espera o antigo, sem login simultâneo", async () => {
      const cache = createTokenCache();
      const { fn, release } = controlledLogin();

      const old = cache.getOrLogin("c1", fn);
      await flush();
      cache.invalidateAll();
      const fresh = [cache.getOrLogin("c1", fn), cache.getOrLogin("c1", fn)];
      await flush();
      expect(fn).toHaveBeenCalledTimes(1);

      release();
      await old;
      await flush();
      expect(fn).toHaveBeenCalledTimes(2);

      release();
      const results = (await Promise.all(fresh)) as LoginSuccess[];
      expect(results.map((result) => result.accessToken)).toEqual(["TOKEN-2", "TOKEN-2"]);
      expect(cache.get("c1")?.accessToken).toBe("TOKEN-2");
    });
  });

  describe("401", () => {
    it("sem 401, não faz novo login", async () => {
      const cache = createTokenCache();
      const login = sequentialLogin();

      const result = await cache.callWithToken(
        "c1",
        login,
        async (current) => ({ status: 500, token: current.accessToken }),
        is401,
      );

      expect(result).toEqual({ ok: true, value: { status: 500, token: "TOKEN-1" } });
      expect(login).toHaveBeenCalledTimes(1);
    });

    it("com 401, faz um novo login e repete a chamada com o token novo", async () => {
      const cache = createTokenCache();
      const login = sequentialLogin();
      const call = vi.fn(async (current: LoginSuccess) => ({
        status: current.accessToken === "TOKEN-1" ? 401 : 200,
        token: current.accessToken,
      }));

      const result = await cache.callWithToken("c1", login, call, is401);

      expect(result).toEqual({ ok: true, value: { status: 200, token: "TOKEN-2" } });
      expect(login).toHaveBeenCalledTimes(2);
      expect(call).toHaveBeenCalledTimes(2);
      expect(cache.get("c1")?.accessToken).toBe("TOKEN-2");
    });

    it("com novo 401, para sem terceiro login e devolve o 401", async () => {
      const cache = createTokenCache();
      const login = sequentialLogin();
      const call = vi.fn(async (current: LoginSuccess) => ({ status: 401, token: current.accessToken }));

      const result = await cache.callWithToken("c1", login, call, is401);

      expect(result).toEqual({ ok: true, value: { status: 401, token: "TOKEN-2" } });
      expect(login).toHaveBeenCalledTimes(2);
      expect(call).toHaveBeenCalledTimes(2);
      expect(cache.get("c1")).toBeUndefined();
    });

    it("se o novo login falhar, devolve a falha sem repetir a chamada", async () => {
      const cache = createTokenCache();
      cache.set("c1", token("ANTIGO"));
      const login = vi.fn<LoginFn>(async () => failure);
      const call = vi.fn(async (current: LoginSuccess) => ({ status: 401, token: current.accessToken }));

      const result = await cache.callWithToken("c1", login, call, is401);

      expect(result).toBe(failure);
      expect(login).toHaveBeenCalledTimes(1);
      expect(call).toHaveBeenCalledTimes(1);
      expect(cache.get("c1")).toBeUndefined();
    });

    it("401 simultâneos com o mesmo token geram um único novo login", async () => {
      const cache = createTokenCache();
      const { fn, release } = controlledLogin();
      cache.set("c1", token("ANTIGO"));
      const call = async (current: LoginSuccess) => ({
        status: current.accessToken === "ANTIGO" ? 401 : 200,
        token: current.accessToken,
      });

      const calls = [cache.callWithToken("c1", fn, call, is401), cache.callWithToken("c1", fn, call, is401)];
      await flush();
      release();
      const results = await Promise.all(calls);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(results).toEqual([
        { ok: true, value: { status: 200, token: "TOKEN-1" } },
        { ok: true, value: { status: 200, token: "TOKEN-1" } },
      ]);
    });

    it("401 tardio de token antigo não descarta o token já renovado", async () => {
      const cache = createTokenCache();
      cache.set("c1", token("ANTIGO"));
      const login = sequentialLogin();
      let answerLate: (value: Response) => void = () => undefined;
      const lateCall = cache.callWithToken(
        "c1",
        login,
        (current) =>
          current.accessToken === "ANTIGO"
            ? new Promise<Response>((resolve) => {
                answerLate = resolve;
              })
            : Promise.resolve({ status: 200, token: current.accessToken }),
        is401,
      );
      await flush();

      cache.set("c1", token("JA-RENOVADO"));
      answerLate({ status: 401, token: "ANTIGO" });

      expect(await lateCall).toEqual({ ok: true, value: { status: 200, token: "JA-RENOVADO" } });
      expect(login).not.toHaveBeenCalled();
    });
  });

  describe("com adaptador e servidor falso", () => {
    let fake: FakeSalesforce;

    beforeEach(async () => {
      fake = await startFakeSalesforce({ users: [{ username: "u@teste.invalid", password: "SENTINELA-SENHA-123" }] });
    });

    afterEach(async () => {
      await fake.close();
    });

    it("reaproveita o token e, quando expira, faz um único novo login e usa o token novo", async () => {
      const cache = createTokenCache();
      const adapter = createUsernamePasswordAdapter({ timeoutMs: 2000 });
      const login = () =>
        adapter.login({
          loginUrl: fake.url,
          clientId: FAKE_CLIENT_ID,
          username: "u@teste.invalid",
          password: "SENTINELA-SENHA-123",
        });
      const userinfo = async (current: LoginSuccess) => {
        const response = await fetch(`${fake.url}/services/oauth2/userinfo`, {
          headers: { Authorization: `Bearer ${current.accessToken}` },
        });
        return { status: response.status, token: current.accessToken };
      };

      await cache.callWithToken("c1", login, userinfo, is401);
      await cache.callWithToken("c1", login, userinfo, is401);
      expect(fake.calls("/services/oauth2/token")).toHaveLength(1);

      // HIPÓTESE: 401 para token expirado vem de fonte indireta (fluxos-login.md, 4.3, B9).
      fake.expireAllTokens();
      const result = await cache.callWithToken("c1", login, userinfo, is401);

      expect(result).toEqual({ ok: true, value: { status: 200, token: "SENTINELA-TOKEN-2" } });
      expect(fake.calls("/services/oauth2/token")).toHaveLength(2);
      expect(fake.calls("/services/oauth2/userinfo")).toHaveLength(4);
    });
  });
});
