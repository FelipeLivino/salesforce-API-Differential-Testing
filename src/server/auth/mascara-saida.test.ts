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
import { createTesteLoginService } from "../services/teste-login-service";
import { createHeadlessAdapter } from "./adapters/headless";
import { createLoginService } from "./login-service";
import { buildSuccess, failureFromBody, readTokenResponse, tokenDestinationProblem } from "./oauth-http";
import { createLoginRegistry } from "./registry";
import { createTokenCache } from "./token-cache";
import type { LoginAdapter, LoginResult } from "./types";

/** Casos do QA (FT.2 e FT.3), verificados no que sai para a API: o retorno de Testar login. */
const SENHA = "SENTINELA-SENHA-123";
const USUARIO = "comunidade@teste.invalid";
const CODE = "VALORCODELIVRE";
const AUTHORIZE = "/services/oauth2/authorize";
const TOKEN = "/services/oauth2/token";
const USERINFO = "/services/oauth2/userinfo";

describe("saída de Testar login (T16)", () => {
  let fake: FakeSalesforce;
  let db: Db;
  let cadastros: Cadastros;

  beforeEach(async () => {
    vi.stubEnv("SECRETS_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    fake = await startFakeSalesforce({ users: [{ username: USUARIO, password: SENHA }] });
    db = openDatabase({ path: ":memory:" });
    cadastros = createCadastros(db, {
      tokens: { invalidate: () => undefined, invalidateAll: () => undefined },
      tipoLoginValido: () => true,
    });
  });

  afterEach(async () => {
    db.close();
    await fake.close();
    vi.unstubAllEnvs();
  });

  function testar(tipoLogin: string, registry?: ReturnType<typeof createLoginRegistry>) {
    const contextos = createContextosRepository(db);
    const perfis = createPerfisRepository(db);
    const ambiente = cadastros.ambientes.criar({
      url: fake.url,
      tipo: "sandbox",
      app: { clientId: FAKE_CLIENT_ID, redirectUri: `${fake.url}/callback` },
    });
    const perfil = cadastros.perfis.criar({ nome: "perfil-do-teste", tipoLogin });
    const contexto = cadastros.contextos.criar({
      ambienteId: ambiente.id,
      perfilId: perfil.id,
      url: fake.url,
      login: USUARIO,
      senha: SENHA,
    });
    const login = createLoginService({
      contextos,
      ambientes: createAmbientesRepository(db),
      perfis,
      tokens: createTokenCache(),
      ...(registry ? { registry } : {}),
    });
    return createTesteLoginService(contextos, perfis, login).testar(contexto.id);
  }

  function responderAuthorize(status: number, body: string, contentType = "application/json"): void {
    fake.overrides.set(AUTHORIZE, (res) => {
      res.writeHead(status, { "Content-Type": contentType });
      res.end(body);
    });
  }

  function responderToken(campos: Record<string, unknown>): void {
    fake.overrides.set(TOKEN, (res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(campos));
    });
  }

  /** Authorize real do servidor falso, trocando só o code, para o teste conhecer o valor. */
  function authorizeComCode(code: string): void {
    fake.overrides.set(AUTHORIZE, (res, request) => {
      const location = new URL(`${fake.url}/callback`);
      location.searchParams.set("code", code);
      location.searchParams.set("sfdc_community_url", fake.url);
      location.searchParams.set("state", request.form.get("state") ?? "");
      res.writeHead(302, { Location: location.toString() });
      res.end();
    });
  }

  it("authorize 400 JSON com code livre em error_description", async () => {
    responderAuthorize(400, JSON.stringify({ error: "x_erro", error_description: `code=${CODE} recusado` }));

    const saida = await testar("headless");

    expect(saida).toMatchObject({ ok: false, error: "x_erro", errorDescription: "code=*** recusado" });
    expect(JSON.stringify(saida)).not.toContain(CODE);
    expect((saida as { rawBody: string }).rawBody).toContain("recusado");
  });

  it("authorize 302 com error_description=falhou+code%3DVALOR", async () => {
    fake.overrides.set(AUTHORIZE, (res) => {
      res.writeHead(302, { Location: `${fake.url}/callback?error=x_erro&error_description=falhou+code%3D${CODE}` });
      res.end();
    });

    const saida = await testar("headless");

    expect(saida).toMatchObject({ ok: false, error: "x_erro", errorDescription: "falhou code=***" });
    expect(JSON.stringify(saida)).not.toContain(CODE);
  });

  it("authorize 400 com code entre colchetes", async () => {
    responderAuthorize(400, `falha [code=${CODE}]`, "text/plain");

    const saida = await testar("headless");

    expect(saida).toMatchObject({ ok: false, rawBody: "falha [code=***]" });
  });

  it("authorize 200 HTML com code livre", async () => {
    responderAuthorize(200, "<p>code=SENTINELA-CODE-7 recusado</p>", "text/html");

    const saida = await testar("headless");

    expect(saida).toMatchObject({ ok: false, rawBody: "<p>code=*** recusado</p>" });
  });

  it("token 200 com access_token repetido em error e error_description", async () => {
    responderToken({
      access_token: "SENTINELA-TOKEN-NOVO",
      refresh_token: "SENTINELA-REFRESH-NOVO",
      error: "falha SENTINELA-TOKEN-NOVO",
      error_description: "token SENTINELA-TOKEN-NOVO e SENTINELA-REFRESH-NOVO recusados",
    });

    const saida = await testar("username-password");

    expect(saida).toMatchObject({
      ok: false,
      error: "falha ***",
      errorDescription: "token *** e *** recusados",
    });
    expect(JSON.stringify(saida)).not.toContain("SENTINELA");
  });

  it("token 200 com sfdc_community_url contendo o code é recusado", async () => {
    authorizeComCode("SENTINELA-CODE-8");
    responderToken({ access_token: "SENTINELA-TOKEN-NOVO", sfdc_community_url: `${fake.url}/SENTINELA-CODE-8` });

    const saida = await testar("headless");

    expect(saida.ok).toBe(false);
    expect(JSON.stringify(saida)).not.toContain("SENTINELA");
    expect(fake.calls(USERINFO)).toHaveLength(0);
  });

  it("token 200 com sfdc_community_url contendo o verificador é recusado", async () => {
    let verificador = "";
    fake.overrides.set(TOKEN, (res, request) => {
      verificador = request.form.get("code_verifier") ?? "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ access_token: "SENTINELA-TOKEN-NOVO", sfdc_community_url: `${fake.url}/${verificador}` }));
    });

    const saida = await testar("headless");

    expect(saida.ok).toBe(false);
    expect(verificador).not.toBe("");
    expect(JSON.stringify(saida)).not.toContain(verificador);
    expect(fake.calls(USERINFO)).toHaveLength(0);
  });

  it("instanceUrl de sucesso recebe os maskValues, mesmo com adaptador que não valida a URL", async () => {
    const resultado: LoginResult = {
      ok: true,
      accessToken: "SENTINELA-TOKEN-NOVO",
      instanceUrl: "",
      issuedAt: new Date(),
      expiresAt: null,
      expiresAtSource: "nao-informado",
      maskValues: ["SENTINELA-CODE-9"],
    };
    const adaptador: LoginAdapter = {
      type: "adaptador-do-teste",
      login: async () => ({ ...resultado, instanceUrl: `${fake.url}/SENTINELA-CODE-9` }),
    };
    fake.overrides.set(USERINFO, (res) => res.end("{}"));

    const saida = await testar("adaptador-do-teste", createLoginRegistry([adaptador]));

    expect(saida).toMatchObject({ ok: true, instanceUrl: `${fake.url}/***` });
  });

  it("toda falha passa pela máscara final, mesmo vinda de adaptador que não mascara", async () => {
    const adaptador: LoginAdapter = {
      type: "adaptador-do-teste",
      login: async () => ({
        ok: false,
        kind: "salesforce",
        error: `erro ${SENHA}`,
        errorDescription: `descricao ${SENHA}`,
        rawBody: `corpo ${SENHA} code=${CODE}`,
        message: `mensagem ${SENHA}`,
      }),
    };

    const saida = await testar("adaptador-do-teste", createLoginRegistry([adaptador]));

    expect(saida).toMatchObject({
      error: "erro ***",
      errorDescription: "descricao ***",
      rawBody: "corpo *** code=***",
      message: "mensagem ***",
    });
  });

  it("falha do userinfo repete code, verificador e refresh_token: nada sai aberto", async () => {
    authorizeComCode("SENTINELA-CODE-10");
    let verificador = "";
    fake.overrides.set(TOKEN, (res, request) => {
      verificador = request.form.get("code_verifier") ?? "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ access_token: "SENTINELA-TOKEN-NOVO", refresh_token: "SENTINELA-REFRESH-NOVO", sfdc_community_url: fake.url }),
      );
    });
    fake.overrides.set(USERINFO, (res) => {
      res.writeHead(403);
      res.end(`SENTINELA-CODE-10 ${verificador} SENTINELA-REFRESH-NOVO SENTINELA-TOKEN-NOVO`);
    });

    const saida = await testar("headless");

    expect(saida).toMatchObject({ ok: false, rawBody: "*** *** *** ***" });
  });
});

describe("destino do token no Username-Password (T16)", () => {
  let fake: FakeSalesforce;
  let db: Db;

  beforeEach(async () => {
    vi.stubEnv("SECRETS_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    fake = await startFakeSalesforce({ users: [{ username: USUARIO, password: SENHA }] });
    db = openDatabase({ path: ":memory:" });
  });

  afterEach(async () => {
    db.close();
    await fake.close();
    vi.unstubAllEnvs();
  });

  it.each(["https://atacante.example", "https://evilsalesforce.com", "http://empresa.my.salesforce.com"])(
    "recusa instance_url %s, sem enviar o token",
    async (instancia) => {
      fake.extraTokenFields = { instance_url: instancia };
      const cadastros = createCadastros(db, {
        tokens: { invalidate: () => undefined, invalidateAll: () => undefined },
        tipoLoginValido: () => true,
      });
      const ambiente = cadastros.ambientes.criar({ url: fake.url, tipo: "sandbox", app: { clientId: FAKE_CLIENT_ID } });
      const perfil = cadastros.perfis.criar({ nome: "perfil-do-teste", tipoLogin: "username-password" });
      const contexto = cadastros.contextos.criar({
        ambienteId: ambiente.id,
        perfilId: perfil.id,
        url: fake.url,
        login: USUARIO,
        senha: SENHA,
      });
      const fetchEspiado = vi.spyOn(globalThis, "fetch");
      const login = createLoginService({
        contextos: createContextosRepository(db),
        ambientes: createAmbientesRepository(db),
        perfis: createPerfisRepository(db),
        tokens: createTokenCache(),
      });

      const saida = await login.testLogin(contexto.id);

      expect(saida).toMatchObject({ ok: false, kind: "salesforce", step: "token" });
      expect((saida as { message: string }).message).toContain("instance_url");
      expect(JSON.stringify(saida)).not.toContain("SENTINELA-TOKEN");
      expect(fetchEspiado).toHaveBeenCalledTimes(1);
      fetchEspiado.mockRestore();
    },
  );
});

describe("o erro real continua legível na saída (T17)", () => {
  const LOGIN = "https://login.teste.invalid";
  const resposta = (status: number, corpo: unknown) => ({
    status,
    location: null,
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });

  it.each([400, 200])("HTTP %i com error não promove token a segredo global", (status) => {
    const corpo = { error: "invalid_token", error_description: "the token is invalid", token: "invalid" };

    expect(failureFromBody("token", resposta(status, corpo), [], "m")).toMatchObject({
      error: "invalid_token",
      errorDescription: "the token is invalid",
      rawBody: '{"error":"invalid_token","error_description":"the token is invalid","token":"***"}',
    });
  });

  it.each([400, 200])("HTTP %i não vira auth***ntication", (status) => {
    const corpo = { error: "invalid_grant", error_description: "authentication failure", token: "e", code: "e" };

    expect(failureFromBody("token", resposta(status, corpo), [], "m")).toMatchObject({
      error: "invalid_grant",
      errorDescription: "authentication failure",
    });
  });

  it("HTTP 400 não promove nem access_token: só o próprio campo é mascarado", () => {
    const corpo = { error: "x", error_description: "access token expired", access_token: "expired" };

    expect(failureFromBody("token", resposta(400, corpo), [], "m")).toMatchObject({
      errorDescription: "access token expired",
      rawBody: '{"error":"x","error_description":"access token expired","access_token":"***"}',
    });
  });

  it("HTTP 200 com error só promove access_token e refresh_token com aspecto de segredo", () => {
    const corpo = {
      error: "x",
      error_description: "access token expired SENTINELA-TOKEN-NOVO",
      access_token: "expired",
      refresh_token: "SENTINELA-TOKEN-NOVO",
    };

    expect(failureFromBody("token", resposta(200, corpo), [], "m")).toMatchObject({
      errorDescription: "access token expired ***",
    });
  });

  it.each([{ access_token: { value: "SENTINELA-V3" } }, { access_token: ["a", "SENTINELA-V3"] }])(
    "HTTP 200 com token em estrutura (V3): %j",
    (campos) => {
      const corpo = { ...campos, mensagem: "repete SENTINELA-V3" };

      const saida = readTokenResponse("token", resposta(200, corpo), []);

      expect(JSON.stringify(saida)).not.toContain("SENTINELA-V3");
      expect(saida).toMatchObject({ ok: false, message: "A resposta do servidor não contém access_token." });
    },
  );

  it("sucesso com refresh_token em objeto entra em maskValues (V3)", () => {
    const json = { access_token: "T-T-T-T", refresh_token: { value: "SENTINELA-V3" }, instance_url: LOGIN };

    const saida = buildSuccess(
      "token",
      resposta(200, json),
      json,
      { name: "instance_url", value: LOGIN, loginUrl: LOGIN },
      [],
    );

    expect(saida).toMatchObject({ ok: true, maskValues: expect.arrayContaining(["T-T-T-T", "SENTINELA-V3"]) });
  });

  it("segredo conhecido curto não recusa a URL de destino, e o inteiro continua recusando", () => {
    const destino = "https://empresa.my.salesforce.com";
    expect(tokenDestinationProblem(destino, LOGIN, ["sa", "s", "e"])).toBeNull();
    expect(tokenDestinationProblem(`${destino}/ab`, LOGIN, ["ab"])).toBe("contém um valor sensível");
    expect(tokenDestinationProblem(`${destino}/SEGRED0x`, LOGIN, ["SEGRED0"])).toBe("contém um valor sensível");
  });

  it("sucesso com signature curta não recusa o login", () => {
    const json = { access_token: "T-T-T-T", signature: "s", instance_url: "https://empresa.my.salesforce.com" };

    const saida = buildSuccess(
      "token",
      resposta(200, json),
      json,
      { name: "instance_url", value: json.instance_url, loginUrl: LOGIN },
      [],
    );

    expect(saida.ok).toBe(true);
  });

  it.each(["https://.salesforce.com", "https://a..salesforce.com", "https://.force.com", "https://.site.com"])(
    "recusa rótulo vazio em %s",
    (destino) => {
      expect(tokenDestinationProblem(destino, LOGIN)).toContain("precisa ter a mesma origem");
    },
  );

  it("redirect de erro do authorize não promove code nem token", async () => {
    const fake = await startFakeSalesforce({ users: [] });
    try {
      fake.overrides.set("/services/oauth2/authorize", (res) => {
        const q = "error=invalid_grant&error_description=authentication+failure&token=e&code=a";
        res.writeHead(302, { Location: `${fake.url}/callback?${q}` });
        res.end();
      });

      const saida = await createHeadlessAdapter().login({
        loginUrl: fake.url,
        clientId: FAKE_CLIENT_ID,
        redirectUri: `${fake.url}/callback`,
        username: USUARIO,
        password: SENHA,
      });

      expect(saida).toMatchObject({ ok: false, error: "invalid_grant", errorDescription: "authentication failure" });
      expect((saida as { rawBody: string }).rawBody).toContain("token=***&code=***");
    } finally {
      await fake.close();
    }
  });
});
