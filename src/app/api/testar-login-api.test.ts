import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTokenCache } from "@/server/auth/token-cache";
import type { LoginSuccess } from "@/server/auth/types";
import { closeDatabase, getDatabase } from "@/server/db/connection";
import { getLoginService } from "@/server/services";
import type {
  AmbienteDto,
  ContextoDto,
  ErroResponse,
  ListaResponse,
  PerfilDto,
  TesteLoginFalha,
  TesteLoginResponse,
  TesteLoginSucesso,
  TipoLoginDto,
} from "@/shared/dto";
import { FAKE_CLIENT_ID, type FakeSalesforce, startFakeSalesforce } from "../../../tests/fake-salesforce/server";
import * as ambientes from "./ambientes/route";
import * as ambienteId from "./ambientes/[id]/route";
import * as testarLogin from "./contextos/[id]/testar-login/route";
import * as contextos from "./contextos/route";
import * as contextoId from "./contextos/[id]/route";
import * as perfis from "./perfis/route";
import * as perfilId from "./perfis/[id]/route";
import * as tiposLogin from "./tipos-login/route";

const SENHA = "SENTINELA-SENHA-123";
const SENHA_ESPECIAL = "SENTINELA-SENHA ç&=+%/#\"'";
const SECURITY_TOKEN = "SENTINELA-SECTOKEN-456";
const CLIENT_SECRET = "SENTINELA-SECRET-789";
const USUARIO = "usuario@teste.invalid";
const AUTHORIZE = "/services/oauth2/authorize";
const TOKEN = "/services/oauth2/token";
const USERINFO = "/services/oauth2/userinfo";

const json = (body: unknown, method = "POST") =>
  new Request("http://127.0.0.1/api", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const rota = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

describe("Testar login e tipos de login", () => {
  let dir: string;
  let chave: string;
  let fake: FakeSalesforce;
  let errosNoConsole: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "api-testar-login-"));
    chave = randomBytes(32).toString("base64");
    vi.stubEnv("DATABASE_PATH", path.join(dir, "app.db"));
    vi.stubEnv("SECRETS_ENCRYPTION_KEY", chave);
    errosNoConsole = vi.spyOn(console, "error");
    fake = await startFakeSalesforce({
      clientSecret: CLIENT_SECRET,
      users: [
        { username: USUARIO, password: SENHA },
        { username: "com-token@teste.invalid", password: SENHA, securityToken: SECURITY_TOKEN },
        { username: "especial@teste.invalid", password: SENHA_ESPECIAL },
        { username: "outro@teste.invalid", password: SENHA },
      ],
    });
  });

  afterEach(async () => {
    expect(JSON.stringify(errosNoConsole.mock.calls)).not.toContain("SENTINELA");
    getTokenCache().invalidateAll();
    closeDatabase();
    await fake.close();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  async function criar(
    tipoLogin = "username-password",
    extra: { login?: string; senha?: string; securityToken?: string; url?: string } = {},
  ) {
    const url = extra.url ?? fake.url;
    const ambiente = (await (
      await ambientes.POST(
        json({
          url,
          tipo: "sandbox",
          app: { clientId: FAKE_CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: `${url}/callback` },
        }),
      )
    ).json()) as AmbienteDto;
    const perfil = (await (await perfis.POST(json({ nome: "perfil-do-teste", tipoLogin }))).json()) as PerfilDto;
    const resposta = await contextos.POST(
      json({
        ambienteId: ambiente.id,
        perfilId: perfil.id,
        url,
        login: extra.login ?? USUARIO,
        senha: extra.senha ?? SENHA,
        ...(extra.securityToken && { securityToken: extra.securityToken }),
      }),
    );
    expect(resposta.status).toBe(201);
    return { ambiente, perfil, contexto: (await resposta.json()) as ContextoDto };
  }

  /** Testa pela rota e confirma que nenhum segredo saiu na resposta (FT.2). */
  async function testar(id: number): Promise<TesteLoginResponse> {
    const resposta = await testarLogin.POST(json({}), rota(id));
    expect(resposta.status).toBe(200);
    const texto = await resposta.text();
    for (const segredo of ["SENTINELA-SENHA", SECURITY_TOKEN, CLIENT_SECRET, "SENTINELA-TOKEN", "SENTINELA-CODIGO", chave]) {
      expect(texto).not.toContain(segredo);
    }
    return JSON.parse(texto) as TesteLoginResponse;
  }

  const adulterar = (cifrado: string) => {
    const partes = cifrado.split(".");
    const dados = partes[3]!;
    partes[3] = `${dados[0] === "A" ? "B" : "A"}${dados.slice(1)}`;
    return partes.join(".");
  };

  describe("tipos de login", () => {
    it("lista os tipos do registro para o Frontend", async () => {
      const corpo = (await (await tiposLogin.GET()).json()) as ListaResponse<TipoLoginDto>;
      expect(corpo.itens).toEqual([{ tipo: "headless" }, { tipo: "username-password" }]);
    });

    it("o cadastro recusa tipo sem adaptador e indica o campo (F4.8, decisão 2)", async () => {
      const resposta = await perfis.POST(json({ nome: "n", tipoLogin: "sem-adaptador" }));
      expect(resposta.status).toBe(400);
      const corpo = (await resposta.json()) as ErroResponse;
      expect(corpo.erro.campos?.map((campo) => campo.campo)).toEqual(["tipoLogin"]);
    });
  });

  describe("rota", () => {
    it("responde 404 para contexto inexistente e 415 sem application/json, sem chamada externa", async () => {
      const { contexto } = await criar();
      expect((await testarLogin.POST(json({}), rota(9999))).status).toBe(404);
      const semJson = new Request("http://127.0.0.1/api", { method: "POST" });
      expect((await testarLogin.POST(semJson, rota(contexto.id))).status).toBe(415);
      expect(fake.requests).toEqual([]);
    });

    it("recusa com 409 o contexto arquivado, sem chamada externa (C4)", async () => {
      const { contexto } = await criar();
      await contextoId.PATCH(json({ situacao: "arquivado" }, "PATCH"), rota(contexto.id));

      const resposta = await testarLogin.POST(json({}), rota(contexto.id));

      expect(resposta.status).toBe(409);
      expect(((await resposta.json()) as ErroResponse).erro.codigo).toBe("CONFLITO");
      expect(fake.requests).toEqual([]);
    });

    it("recusa com 409 o contexto de perfil arquivado, e volta a testar se reativado (C4, C3)", async () => {
      const { contexto, perfil } = await criar();
      await perfilId.PATCH(json({ situacao: "arquivado" }, "PATCH"), rota(perfil.id));

      expect((await testarLogin.POST(json({}), rota(contexto.id))).status).toBe(409);
      expect(fake.requests).toEqual([]);

      await perfilId.PATCH(json({ situacao: "ativo" }, "PATCH"), rota(perfil.id));
      expect((await testar(contexto.id)).ok).toBe(true);
    });
  });

  describe("cadastro e criptografia", () => {
    it("editar sem informar senha mantém a atual, e o login continua funcionando (F2.11)", async () => {
      const { contexto } = await criar();
      for (const corpo of [{ url: fake.url }, { url: fake.url, senha: "" }]) {
        const edicao = await contextoId.PATCH(json(corpo, "PATCH"), rota(contexto.id));
        expect(edicao.status).toBe(200);
      }

      expect((await testar(contexto.id)).ok).toBe(true);
      expect(fake.calls(TOKEN)[0]?.form.get("password")).toBe(SENHA);
    });

    it("a senha chega idêntica ao servidor falso nos dois fluxos (F3.3)", async () => {
      const opcoes = { login: "especial@teste.invalid", senha: SENHA_ESPECIAL };
      const integracao = await criar("username-password", opcoes);
      const comunidade = await criar("headless", opcoes);

      expect((await testar(integracao.contexto.id)).ok).toBe(true);
      expect((await testar(comunidade.contexto.id)).ok).toBe(true);
      expect(fake.calls(TOKEN)[0]?.form.get("password")).toBe(SENHA_ESPECIAL);
      expect(fake.calls(AUTHORIZE)[0]?.form.get("password")).toBe(SENHA_ESPECIAL);
    });

    it.each([
      ["senha", "contextos", "senha_cifrada"],
      ["security token", "contextos", "security_token_cifrado"],
      ["Client Secret", "apps_oauth", "client_secret_cifrado"],
    ])("%s adulterado falha com erro claro, sem chamada (F3.4)", async (_nome, tabela, coluna) => {
      const { contexto } = await criar("username-password", { securityToken: SECURITY_TOKEN });
      const db = getDatabase();
      const { valor } = db.prepare(`SELECT ${coluna} AS valor FROM ${tabela}`).get() as { valor: string };
      db.prepare(`UPDATE ${tabela} SET ${coluna} = ?`).run(adulterar(valor));

      const resultado = (await testar(contexto.id)) as TesteLoginFalha;

      expect(resultado).toMatchObject({ ok: false, kind: "configuracao" });
      expect(resultado.message).toContain("adulterado");
      expect(fake.requests).toEqual([]);
    });

    it("valor em formato inválido no banco falha sem chamada (F3.4)", async () => {
      const { contexto } = await criar();
      getDatabase().prepare("UPDATE contextos SET senha_cifrada = ?").run("nao-e-um-valor-cifrado");

      expect(await testar(contexto.id)).toMatchObject({ ok: false, kind: "configuracao" });
      expect(fake.requests).toEqual([]);
    });

    it("com chave diferente, falha com erro claro, sem chamada e sem expor a chave (F3.5)", async () => {
      const { contexto } = await criar();
      const outra = randomBytes(32).toString("base64");
      vi.stubEnv("SECRETS_ENCRYPTION_KEY", outra);

      const resultado = (await testar(contexto.id)) as TesteLoginFalha;

      expect(resultado).toMatchObject({ ok: false, kind: "configuracao" });
      expect(resultado.message).toContain("SECRETS_ENCRYPTION_KEY");
      expect(JSON.stringify(resultado)).not.toContain(outra);
      expect(fake.requests).toEqual([]);
    });

    it("sem chave, falha como configuração, sem chamada (F3.5, F3.6)", async () => {
      const { contexto } = await criar();
      vi.stubEnv("SECRETS_ENCRYPTION_KEY", "");

      expect(await testar(contexto.id)).toMatchObject({ ok: false, kind: "configuracao" });
      expect(fake.requests).toEqual([]);
    });
  });

  describe("adaptadores", () => {
    it("Headless autentica por authorize, token e userinfo, sem OAuth antigo (F4.1, F4.6, F5.6)", async () => {
      fake.communityPath = "/site";
      const { contexto } = await criar("headless");

      const resultado = (await testar(contexto.id)) as TesteLoginSucesso;

      expect(resultado).toEqual({
        ok: true,
        instanceUrl: `${fake.url}/site`,
        expiresAt: null,
        expiresAtSource: "nao-informado",
        testeToken: { endpoint: USERINFO, httpStatus: 200 },
      });
      expect(fake.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
        `POST ${AUTHORIZE}`,
        `POST /site${TOKEN}`,
        `GET /site${USERINFO}`,
      ]);
      expect(fake.calls(TOKEN)[0]?.form.get("grant_type")).toBe("authorization_code");
      expect(fake.requests.some((request) => request.form.get("response_type") === "token")).toBe(false);
    });

    it("PKCE divergente não mostra sucesso nem chama userinfo (F4.2)", async () => {
      const { contexto } = await criar("headless");
      fake.corruptNextChallenge = true;

      expect(await testar(contexto.id)).toMatchObject({
        ok: false,
        kind: "salesforce",
        step: "token",
        error: "invalid_grant",
      });
      expect(fake.calls(USERINFO)).toEqual([]);
    });

    it("cada tentativa Headless usa um verificador novo (F4.3)", async () => {
      const { contexto } = await criar("headless");
      await testar(contexto.id);
      await testar(contexto.id);

      const verificadores = fake.calls(TOKEN).map((request) => request.form.get("code_verifier"));
      expect(verificadores).toHaveLength(2);
      expect(verificadores[0]).not.toBe(verificadores[1]);
    });

    it("Username-Password usa a URL, o login e o app do cadastro, sem chamadas extras (F4.4, F5.6)", async () => {
      const { contexto } = await criar();

      expect((await testar(contexto.id)).ok).toBe(true);
      const form = fake.calls(TOKEN)[0]?.form;
      expect(form?.get("grant_type")).toBe("password");
      expect(form?.get("username")).toBe(USUARIO);
      expect(form?.get("client_id")).toBe(FAKE_CLIENT_ID);
      expect(form?.get("client_secret")).toBe(CLIENT_SECRET);
      expect(fake.requests.map((request) => request.path)).toEqual([TOKEN, USERINFO]);
    });

    it("o security token chega ao servidor falso quando cadastrado (F4.5)", async () => {
      const { contexto } = await criar("username-password", {
        login: "com-token@teste.invalid",
        securityToken: SECURITY_TOKEN,
      });

      expect((await testar(contexto.id)).ok).toBe(true);
      expect(fake.calls(TOKEN)[0]?.form.get("password")).toBe(`${SENHA}${SECURITY_TOKEN}`);
    });

    it("perfil antigo com tipo sem adaptador gera erro claro, sem chamada (F4.8)", async () => {
      const { contexto } = await criar();
      getDatabase().prepare("UPDATE perfis SET tipo_login = 'tipo-removido'").run();

      const resultado = (await testar(contexto.id)) as TesteLoginFalha;

      expect(resultado).toMatchObject({ ok: false, kind: "configuracao" });
      expect(resultado.message).toContain("adaptador");
      expect(fake.requests).toEqual([]);
    });
  });

  describe("resultado do teste", () => {
    it("mostra literalmente o error e o error_description, mascarando só segredos (F5.2, FT.3)", async () => {
      const { contexto } = await criar();
      fake.overrides.set(TOKEN, (res) => {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "erro_arbitrario_42",
            error_description: `texto arbitrario com ${SENHA} no meio`,
          }),
        );
      });

      const resultado = (await testar(contexto.id)) as TesteLoginFalha;

      expect(resultado).toMatchObject({
        ok: false,
        kind: "salesforce",
        step: "token",
        httpStatus: 400,
        error: "erro_arbitrario_42",
        errorDescription: "texto arbitrario com *** no meio",
      });
      expect(resultado.message).toBeUndefined();
      expect(resultado.rawBody).toContain("erro_arbitrario_42");
    });

    it("401 em userinfo devolve o erro real mascarado e tira o token do cache", async () => {
      const { contexto } = await criar();
      fake.overrides.set(USERINFO, (res, request) => {
        const token = request.headers.authorization?.replace("Bearer ", "");
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify([{ errorCode: "ERRO_ARBITRARIO", message: `token ${token} senha ${SENHA}` }]));
      });

      const resultado = (await testar(contexto.id)) as TesteLoginFalha;

      expect(resultado).toMatchObject({ ok: false, kind: "salesforce", step: "userinfo", httpStatus: 401 });
      expect(resultado.rawBody).toContain("ERRO_ARBITRARIO");
      expect(fake.calls(TOKEN)).toHaveLength(1);
      expect(getTokenCache().get(String(contexto.id))).toBeUndefined();
    });

    it("não segue redirecionamento de userinfo, para o token não ir a outro host", async () => {
      const { contexto } = await criar();
      const outro = await startFakeSalesforce();
      fake.overrides.set(USERINFO, (res) => {
        res.writeHead(302, { Location: `${outro.url}/capturar` });
        res.end();
      });

      expect(await testar(contexto.id)).toMatchObject({ ok: false, step: "userinfo", httpStatus: 302 });
      expect(outro.requests).toEqual([]);
      await outro.close();
    });

    it("servidor desligado gera erro de conexão, distinto de erro do Salesforce (F5.3)", async () => {
      const desligado = await startFakeSalesforce();
      const { contexto } = await criar("username-password", { url: desligado.url });
      await desligado.close();

      const resultado = (await testar(contexto.id)) as TesteLoginFalha;

      expect(resultado).toMatchObject({ ok: false, kind: "rede", step: "token" });
      expect(resultado.error).toBeUndefined();
      expect(resultado.message).toContain("conexão");
    });

    it.each([
      ["token", TOKEN],
      ["userinfo", USERINFO],
    ])("resposta malformada em %s gera erro claro, sem indicar sucesso (F5.4)", async (step, caminho) => {
      const { contexto } = await criar();
      fake.overrides.set(caminho, (res) => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html>nao e json</html>");
      });

      const resultado = (await testar(contexto.id)) as TesteLoginFalha;

      expect(resultado).toMatchObject({ ok: false, kind: "salesforce", step });
      expect(resultado.message).toBeTruthy();
    });
  });

  describe("tokens", () => {
    it("Testar login sempre autentica de novo e grava o token novo no cache (decisão 6, C15)", async () => {
      const { contexto } = await criar();
      const login = getLoginService();

      const antigo = (await login.getToken(contexto.id)) as LoginSuccess;
      await testar(contexto.id);
      const novo = (await login.getToken(contexto.id)) as LoginSuccess;

      expect(fake.calls(TOKEN)).toHaveLength(2);
      expect(novo.accessToken).not.toBe(antigo.accessToken);
    });

    it("usa o cache único com a chave String(contexto.id)", async () => {
      const { contexto } = await criar();
      const token = (await getLoginService().getToken(contexto.id)) as LoginSuccess;

      expect(getTokenCache().get(String(contexto.id))?.accessToken).toBe(token.accessToken);
    });

    it("o token não é gravado em nenhum arquivo (F6.4)", async () => {
      const { contexto } = await criar();
      await testar(contexto.id);
      expect(getTokenCache().get(String(contexto.id))).toBeDefined();
      getDatabase().pragma("wal_checkpoint(FULL)");

      for (const arquivo of readdirSync(dir)) {
        expect(readFileSync(path.join(dir, arquivo)).includes("SENTINELA-TOKEN")).toBe(false);
      }
    });

    it("editar senha ou login do contexto não reaproveita o token anterior (F6.6)", async () => {
      const { contexto } = await criar();
      const login = getLoginService();
      await login.getToken(contexto.id);

      await contextoId.PATCH(json({ senha: SENHA }, "PATCH"), rota(contexto.id));
      await login.getToken(contexto.id);
      expect(fake.calls(TOKEN)).toHaveLength(2);

      await contextoId.PATCH(json({ login: "outro@teste.invalid" }, "PATCH"), rota(contexto.id));
      await login.getToken(contexto.id);
      expect(fake.calls(TOKEN)).toHaveLength(3);
      expect(fake.calls(TOKEN)[2]?.form.get("username")).toBe("outro@teste.invalid");
    });

    it("editar ambiente, app ou perfil invalida o token (P5, C13)", async () => {
      const { contexto, ambiente, perfil } = await criar();
      const login = getLoginService();
      await login.getToken(contexto.id);
      let esperados = 1;

      const edicoes = [
        () => ambienteId.PATCH(json({ tipo: "producao" }, "PATCH"), rota(ambiente.id)),
        () => ambienteId.PATCH(json({ app: { clientId: FAKE_CLIENT_ID } }, "PATCH"), rota(ambiente.id)),
        () => perfilId.PATCH(json({ descricao: "nova" }, "PATCH"), rota(perfil.id)),
      ];
      for (const editar of edicoes) {
        expect((await editar()).status).toBe(200);
        await login.getToken(contexto.id);
        esperados += 1;
        expect(fake.calls(TOKEN)).toHaveLength(esperados);
      }
    });

    it("sem edição, o token continua reaproveitado (F6.1)", async () => {
      const { contexto } = await criar();
      const login = getLoginService();
      await login.getToken(contexto.id);
      await login.getToken(contexto.id);

      expect(fake.calls(TOKEN)).toHaveLength(1);
    });
  });
});
