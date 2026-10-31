import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_CLIENT_ID, type FakeSalesforce, startFakeSalesforce } from "../../../tests/fake-salesforce/server";
import { openDatabase, type Db } from "../db/connection";
import {
  createAmbientesRepository,
  createContextosRepository,
  createPerfisRepository,
} from "../db/repositories";
import { createCadastros, type Cadastros } from "../services";
import { createUsernamePasswordAdapter } from "./adapters/username-password";
import { createLoginService, type LoginServiceDeps } from "./login-service";
import { createLoginRegistry, loginRegistry, type LoginRegistry } from "./registry";
import { createTokenCache, type TokenCache } from "./token-cache";
import type { LoginAdapter, LoginFailure, LoginSuccess } from "./types";
import { USERINFO_PATH } from "./userinfo";

const SENHA = "SENTINELA-SENHA-123";
const TOKEN_PATH = "/services/oauth2/token";

describe("login-service", () => {
  let fake: FakeSalesforce;
  let db: Db;
  let tokens: TokenCache;
  let cadastros: Cadastros;

  beforeEach(async () => {
    vi.stubEnv("SECRETS_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    fake = await startFakeSalesforce({
      users: [
        { username: "um@teste.invalid", password: SENHA },
        { username: "dois@teste.invalid", password: SENHA },
      ],
    });
    db = openDatabase({ path: ":memory:" });
    tokens = createTokenCache();
    cadastros = createCadastros(db, {
      tokens: {
        invalidate: (id) => tokens.invalidate(String(id)),
        invalidateAll: () => tokens.invalidateAll(),
      },
      tipoLoginValido: () => true,
    });
  });

  afterEach(async () => {
    db.close();
    await fake.close();
    vi.unstubAllEnvs();
  });

  const servico = (extra: Partial<LoginServiceDeps> & { registry?: LoginRegistry } = {}) =>
    createLoginService({
      contextos: createContextosRepository(db),
      ambientes: createAmbientesRepository(db),
      perfis: createPerfisRepository(db),
      tokens,
      ...extra,
    });

  function novoContexto(tipoLogin = "username-password", login = "um@teste.invalid") {
    const ambiente = cadastros.ambientes.criar({
      url: fake.url,
      tipo: "sandbox",
      app: { clientId: FAKE_CLIENT_ID, redirectUri: `${fake.url}/callback` },
    });
    const perfil = cadastros.perfis.criar({ nome: "perfil-do-teste", tipoLogin });
    return cadastros.contextos.criar({
      ambienteId: ambiente.id,
      perfilId: perfil.id,
      url: fake.url,
      login,
      senha: SENHA,
    });
  }

  const logins = () => fake.calls(TOKEN_PATH).length;

  it("reaproveita o token do mesmo contexto (F6.1)", async () => {
    const { id } = novoContexto();
    const login = servico();

    const primeiro = (await login.getToken(id)) as LoginSuccess;
    const segundo = (await login.getToken(id)) as LoginSuccess;

    expect(primeiro.ok).toBe(true);
    expect(segundo.accessToken).toBe(primeiro.accessToken);
    expect(logins()).toBe(1);
  });

  it("não compartilha token entre contextos (F6.2)", async () => {
    const login = servico();
    const a = (await login.getToken(novoContexto().id)) as LoginSuccess;
    const b = (await login.getToken(novoContexto("username-password", "dois@teste.invalid").id)) as LoginSuccess;

    expect(a.accessToken).not.toBe(b.accessToken);
    expect(logins()).toBe(2);
  });

  it("após 401, faz um único novo login e usa o token novo (F6.3, decisão 9)", async () => {
    const { id } = novoContexto();
    const login = servico();
    const chamar = async (token: LoginSuccess) =>
      (
        await fetch(`${token.instanceUrl.replace(/\/$/, "")}${USERINFO_PATH}`, {
          headers: { Authorization: `Bearer ${token.accessToken}` },
        })
      ).status;
    const antigo = (await login.getToken(id)) as LoginSuccess;
    fake.expireAllTokens();

    const resultado = await login.callWithToken(id, chamar, (status) => status === 401);

    expect(resultado).toEqual({ ok: true, value: 200 });
    expect(logins()).toBe(2);
    expect(((await login.getToken(id)) as LoginSuccess).accessToken).not.toBe(antigo.accessToken);
    expect(logins()).toBe(2);
  });

  it("um segundo 401 não gera outro login (decisão 9)", async () => {
    const { id } = novoContexto();
    const resultado = await servico().callWithToken(
      id,
      async () => 401,
      (status) => status === 401,
    );

    expect(resultado).toEqual({ ok: true, value: 401 });
    expect(logins()).toBe(2);
  });

  it("com expires_in informado, autentica de novo depois da expiração com margem (F6.3, decisão 4)", async () => {
    let agora = Date.now();
    tokens = createTokenCache({ now: () => agora });
    fake.extraTokenFields = { expires_in: 120 };
    const { id } = novoContexto();
    const login = servico({ tokens });

    await login.getToken(id);
    agora += 59_000;
    await login.getToken(id);
    expect(logins()).toBe(1);

    agora += 2_000;
    await login.getToken(id);
    expect(logins()).toBe(2);
  });

  it("depois de reiniciar, com cache vazio, autentica de novo (F6.5)", async () => {
    const { id } = novoContexto();
    await servico().getToken(id);
    await servico({ tokens: createTokenCache() }).getToken(id);

    expect(logins()).toBe(2);
  });

  it("falha não entra no cache", async () => {
    const { id } = novoContexto("username-password", "desconhecido@teste.invalid");
    const login = servico();

    expect((await login.getToken(id)).ok).toBe(false);
    expect((await login.getToken(id)).ok).toBe(false);
    expect(logins()).toBe(2);
  });

  it("aceita um terceiro adaptador só pelo registro (F4.7)", async () => {
    const entradas: string[] = [];
    const terceiro: LoginAdapter = {
      type: "tipo-do-teste",
      async login(input) {
        entradas.push(input.password);
        return {
          ok: true,
          accessToken: "SENTINELA-TOKEN-TERCEIRO",
          instanceUrl: fake.url,
          issuedAt: new Date(),
          expiresAt: null,
          expiresAtSource: "nao-informado",
        };
      },
    };
    fake.overrides.set(USERINFO_PATH, (res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
    const { id } = novoContexto("tipo-do-teste");

    const resultado = await servico({ registry: createLoginRegistry([terceiro]) }).testLogin(id);

    expect(resultado).toMatchObject({ ok: true, instanceUrl: fake.url });
    expect(JSON.stringify(resultado)).not.toContain("SENTINELA");
    expect(entradas).toEqual([SENHA]);
    expect(tokens.get(String(id))?.accessToken).toBe("SENTINELA-TOKEN-TERCEIRO");
  });

  it("mascara segredos na falha de qualquer adaptador (FT.3)", async () => {
    const descuidado: LoginAdapter = {
      type: "descuidado",
      login: async (input) => ({
        ok: false,
        kind: "salesforce",
        error: `erro com ${input.password}`,
        errorDescription: `descricao com ${input.password}`,
        rawBody: `corpo com ${input.password}`,
      }),
    };
    const { id } = novoContexto("descuidado");

    const falha = (await servico({ registry: createLoginRegistry([descuidado]) }).testLogin(id)) as LoginFailure;

    expect(falha).toMatchObject({ error: "erro com ***", errorDescription: "descricao com ***", rawBody: "corpo com ***" });
  });

  it("mascara code, verificador e token ecoados em userinfo (D2)", async () => {
    const { id } = novoContexto("headless");
    fake.overrides.set(USERINFO_PATH, (res, request) => {
      const form = fake.calls(TOKEN_PATH)[0]!.form;
      const eco = `${form.get("code")} ${form.get("code_verifier")} ${request.headers.authorization?.slice(7)}`;
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "negado", error_description: `eco: ${eco}`, eco }));
    });

    const falha = (await servico().testLogin(id)) as LoginFailure;

    const verificador = fake.calls(TOKEN_PATH)[0]!.form.get("code_verifier")!;
    expect(falha.step).toBe("userinfo");
    expect(falha.errorDescription).toBe("eco: *** *** ***");
    expect(JSON.stringify(falha)).not.toContain(verificador);
    expect(JSON.stringify(falha)).not.toContain("SENTINELA-CODIGO");
    expect(JSON.stringify(falha)).not.toContain("SENTINELA-TOKEN");
  });

  it("mascara o token em cache quando o novo login falha e o ecoa (D2)", async () => {
    const { id } = novoContexto();
    const login = servico();
    const { accessToken } = (await login.getToken(id)) as LoginSuccess;
    const responderEco = (status: number) =>
      fake.overrides.set(TOKEN_PATH, (res) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "x", error_description: `antigo ${accessToken}`, eco: accessToken }));
      });

    responderEco(400);
    const falha = (await login.testLogin(id)) as LoginFailure;

    expect(falha.errorDescription).toBe("antigo ***");
    expect(JSON.stringify(falha)).not.toContain(accessToken);

    const viaGetToken = (await login.getToken(id, { forceRefresh: true })) as LoginFailure;
    expect(JSON.stringify(viaGetToken)).not.toContain(accessToken);
  });

  it("mascara o token em cache quando userinfo o ecoa depois do novo login (D2)", async () => {
    const { id } = novoContexto();
    const login = servico();
    const { accessToken } = (await login.getToken(id)) as LoginSuccess;
    fake.overrides.set(USERINFO_PATH, (res) => {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "x", error_description: `antigo ${accessToken}` }));
    });

    const falha = (await login.testLogin(id)) as LoginFailure;

    expect(falha.errorDescription).toBe("antigo ***");
    expect(JSON.stringify(falha)).not.toContain(accessToken);
  });

  it("mascara o token recusado se o novo login de callWithToken falhar e o ecoar (D2)", async () => {
    const { id } = novoContexto();
    const login = servico();
    const { accessToken } = (await login.getToken(id)) as LoginSuccess;
    fake.overrides.set(TOKEN_PATH, (res) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "x", error_description: `recusado ${accessToken}` }));
    });

    const resultado = await login.callWithToken(id, async () => 401, (status) => status === 401);

    expect(resultado).toMatchObject({ ok: false, errorDescription: "recusado ***" });
  });

  it("Testar login autentica de novo, e getToken e callWithToken reaproveitam (F6.1, C15)", async () => {
    const { id } = novoContexto();
    const login = servico();

    await login.testLogin(id);
    await login.testLogin(id);
    expect(logins()).toBe(2);

    await login.getToken(id);
    await login.callWithToken(id, async () => 200, () => false);
    expect(logins()).toBe(2);
  });

  it("distingue servidor sem resposta no login e no userinfo (F5.3)", async () => {
    const lento = createLoginRegistry([createUsernamePasswordAdapter({ timeoutMs: 100 })]);
    const { id } = novoContexto();
    fake.overrides.set(TOKEN_PATH, () => undefined);

    expect(await servico({ registry: lento }).testLogin(id)).toMatchObject({
      ok: false,
      kind: "rede",
      step: "token",
      message: expect.stringContaining("tempo limite"),
    });

    fake.overrides.clear();
    fake.overrides.set(USERINFO_PATH, () => undefined);
    expect(await servico({ registry: loginRegistry, userinfoTimeoutMs: 100 }).testLogin(id)).toMatchObject({
      ok: false,
      kind: "rede",
      step: "userinfo",
      message: expect.stringContaining("tempo limite"),
    });
  });
});
