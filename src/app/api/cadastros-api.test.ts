import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTokenCache } from "@/server/auth/token-cache";
import type { LoginSuccess } from "@/server/auth/types";
import { closeDatabase } from "@/server/db/connection";
import type { AmbienteDto, ContextoDto, ErroResponse, ListaResponse, PerfilDto, StatusResponse } from "@/shared/dto";
import * as ambientes from "./ambientes/route";
import * as ambienteId from "./ambientes/[id]/route";
import * as contextos from "./contextos/route";
import * as contextoId from "./contextos/[id]/route";
import * as perfis from "./perfis/route";
import * as perfilId from "./perfis/[id]/route";
import * as status from "./status/route";

const SENHA = "SENTINELA-SENHA-123";
const TOKEN = "SENTINELA-TOKEN-789";
const SECRET = "SENTINELA-SECRET-012";
const NOME_PERFIL = "SENTINELA-NOME-DE-PERFIL";

const json = (body: unknown, method = "POST") =>
  new Request("http://127.0.0.1/api", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const rota = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const GET_REQ = new Request("http://127.0.0.1/api");

describe("API de cadastros", () => {
  let dir: string;
  let chave: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "api-cadastros-"));
    chave = randomBytes(32).toString("base64");
    vi.stubEnv("DATABASE_PATH", path.join(dir, "app.db"));
    vi.stubEnv("SECRETS_ENCRYPTION_KEY", chave);
  });

  afterEach(() => {
    closeDatabase();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  describe("GET /api/status (R3)", () => {
    const lerStatus = async () => (await status.GET()).json() as Promise<StatusResponse>;

    it("informa que a chave está pronta, sem mostrá-la", async () => {
      const resposta = await status.GET();
      const texto = await resposta.text();
      expect(resposta.status).toBe(200);
      expect(JSON.parse(texto)).toEqual({ chaveCriptografia: { configurada: true } });
      expect(texto).not.toContain(chave);
    });

    it("avisa quando a chave está ausente", async () => {
      vi.stubEnv("SECRETS_ENCRYPTION_KEY", "");
      expect((await lerStatus()).chaveCriptografia).toEqual({
        configurada: false,
        aviso: expect.stringContaining("não está definida"),
      });
    });

    it("avisa quando a chave é inválida, sem repeti-la", async () => {
      vi.stubEnv("SECRETS_ENCRYPTION_KEY", "SENTINELA-CHAVE-CURTA");
      const { chaveCriptografia } = await lerStatus();
      expect(chaveCriptografia).toEqual({ configurada: false, aviso: expect.stringContaining("inválida") });
      expect(JSON.stringify(chaveCriptografia)).not.toContain("SENTINELA");
    });
  });

  async function criarTudo() {
    const ambiente = (await (
      await ambientes.POST(
        json({
          url: "https://exemplo.test",
          tipo: "sandbox",
          app: { clientId: "client-ficticio", clientSecret: SECRET },
        }),
      )
    ).json()) as AmbienteDto;
    const perfil = (await (
      await perfis.POST(json({ nome: NOME_PERFIL, tipoLogin: "headless" }))
    ).json()) as PerfilDto;
    const resposta = await contextos.POST(
      json({
        ambienteId: ambiente.id,
        perfilId: perfil.id,
        url: "https://site.exemplo.test",
        login: "login-ficticio",
        senha: SENHA,
        securityToken: TOKEN,
      }),
    );
    expect(resposta.status).toBe(201);
    return { ambiente, perfil, contexto: (await resposta.json()) as ContextoDto };
  }

  it("cobre o ciclo completo sem devolver segredo, cifrado ou não (FT.2, F3.7)", async () => {
    const { ambiente, perfil, contexto } = await criarTudo();

    const respostas = await Promise.all([
      ambientes.GET(),
      ambienteId.GET(GET_REQ, rota(ambiente.id)),
      ambienteId.PATCH(json({ tipo: "producao" }, "PATCH"), rota(ambiente.id)),
      perfis.GET(),
      perfilId.GET(GET_REQ, rota(perfil.id)),
      contextos.GET(),
      contextoId.GET(GET_REQ, rota(contexto.id)),
      contextoId.PATCH(json({ login: "outro" }, "PATCH"), rota(contexto.id)),
      contextos.POST(json({ senha: SENHA, securityToken: TOKEN })),
    ]);
    const textos = await Promise.all(respostas.map((resposta) => resposta.text()));
    const tudo = textos.join("\n");

    for (const proibido of [SENHA, TOKEN, SECRET, chave, "v1.", "Cifrad", "cifrad"]) {
      expect(tudo).not.toContain(proibido);
    }
    expect(contexto).toMatchObject({ senhaDefinida: true, securityTokenDefinido: true });
    expect(ambiente.app.clientSecretDefinido).toBe(true);
  });

  it("persiste no banco de DATABASE_PATH, inclusive após reabrir", async () => {
    await criarTudo();
    closeDatabase();
    const lista = (await (await contextos.GET()).json()) as ListaResponse<ContextoDto>;
    expect(lista.itens).toHaveLength(1);
  });

  it("editar o contexto tira do cache só o token dele, e editar o ambiente tira todos", async () => {
    const { ambiente, contexto } = await criarTudo();
    const cache = getTokenCache();
    const token = { ok: true } as LoginSuccess;
    const chaveContexto = String(contexto.id);

    cache.set(chaveContexto, token);
    cache.set("outro-contexto", token);
    await contextoId.PATCH(json({ login: "outro" }, "PATCH"), rota(contexto.id));
    expect(cache.get(chaveContexto)).toBeUndefined();
    expect(cache.get("outro-contexto")).toBe(token);

    await ambienteId.PATCH(json({ url: "https://outra.test", app: { clientSecret: SECRET } }, "PATCH"), rota(ambiente.id));
    expect(cache.get("outro-contexto")).toBeUndefined();
  });

  it("DELETE arquiva com contexto, e exclui sem contexto (F2.7, F2.8)", async () => {
    const { perfil } = await criarTudo();
    const arquivado = await perfilId.DELETE(GET_REQ, rota(perfil.id));
    expect(arquivado.status).toBe(200);
    expect(await arquivado.json()).toMatchObject({ resultado: "arquivado", perfil: { situacao: "arquivado" } });

    const solto = (await (await perfis.POST(json({ nome: "sem-uso", tipoLogin: "headless" }))).json()) as PerfilDto;
    expect(await (await perfilId.DELETE(GET_REQ, rota(solto.id))).json()).toEqual({ resultado: "excluido" });
    expect((await perfilId.GET(GET_REQ, rota(solto.id))).status).toBe(404);
  });

  it("devolve 400 com os campos (F2.10) e 409 para perfil arquivado", async () => {
    const vazio = await perfis.POST(json({ nome: "" }));
    expect(vazio.status).toBe(400);
    const corpo = (await vazio.json()) as ErroResponse;
    expect(corpo.erro.codigo).toBe("VALIDACAO");
    expect(corpo.erro.campos?.map((campo) => campo.campo)).toEqual(["nome", "tipoLogin"]);

    const { ambiente, perfil } = await criarTudo();
    await perfilId.DELETE(GET_REQ, rota(perfil.id));
    const conflito = await contextos.POST(
      json({ ambienteId: ambiente.id, perfilId: perfil.id, url: "https://x.test", login: "l", senha: SENHA }),
    );
    expect(conflito.status).toBe(409);
    expect(await conflito.text()).not.toContain(SENHA);
  });

  it("recusa JSON malformado sem repetir o corpo", async () => {
    const request = new Request("http://127.0.0.1/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: `{"senha": "${SENHA}"`,
    });
    const resposta = await contextos.POST(request);
    expect(resposta.status).toBe(400);
    expect(await resposta.text()).not.toContain(SENHA);
  });

  it.each([[null], ["texto/simples"], ["text/plain"]])("recusa gravação com content-type %s", async (tipo) => {
    const request = new Request("http://127.0.0.1/api", {
      method: "POST",
      headers: tipo ? { "content-type": tipo } : {},
      body: JSON.stringify({ nome: "n", tipoLogin: "t" }),
    });
    const resposta = await perfis.POST(request);
    expect(resposta.status).toBe(415);
    expect(((await perfis.GET().then((r) => r.json())) as ListaResponse<PerfilDto>).itens).toEqual([]);
  });

  it.each(["abc", "0", "-1", "1.5", "99999999999999999999", "999"])("id %s dá 404", async (id) => {
    expect((await contextoId.GET(GET_REQ, rota(id))).status).toBe(404);
  });

  it.each([
    ["ausente", ""],
    ["inválida", "curta"],
  ])("com chave %s, avisa o motivo com 503, sem gravar e sem expor (F3.6)", async (_nome, valor) => {
    const { ambiente, perfil } = await criarTudo();
    vi.stubEnv("SECRETS_ENCRYPTION_KEY", valor);

    const resposta = await contextos.POST(
      json({ ambienteId: ambiente.id, perfilId: perfil.id, url: "https://x.test", login: "l2", senha: SENHA }),
    );
    expect(resposta.status).toBe(503);
    const corpo = (await resposta.json()) as ErroResponse;
    expect(corpo.erro.codigo).toBe("CHAVE_CRIPTOGRAFIA");
    expect(corpo.erro.mensagem).toContain("SECRETS_ENCRYPTION_KEY");
    expect(JSON.stringify(corpo)).not.toContain(SENHA);
    expect(((await (await contextos.GET()).json()) as ListaResponse<ContextoDto>).itens).toHaveLength(1);
  });

  it("erro inesperado vira 500 genérico, e o log não traz a mensagem", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    // Um arquivo no lugar da pasta impede abrir o banco.
    writeFileSync(path.join(dir, "arquivo"), "");
    vi.stubEnv("DATABASE_PATH", path.join(dir, "arquivo", "nao-e-pasta", "x.db"));

    const resposta = await perfis.GET();
    expect(resposta.status).toBe(500);
    const corpo = await resposta.text();
    expect(corpo).toContain("INTERNO");
    expect(corpo).not.toContain("nao-e-pasta");
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("nao-e-pasta");
  });

  it("nenhum nome de perfil dos testes existe no código da aplicação (F2.6)", () => {
    const raiz = path.resolve("src");
    const arquivos = (pasta: string): string[] =>
      readdirSync(pasta).flatMap((nome) => {
        const caminho = path.join(pasta, nome);
        return statSync(caminho).isDirectory() ? arquivos(caminho) : [caminho];
      });
    const codigo = arquivos(raiz).filter((arquivo) => !/\.test\.tsx?$/.test(arquivo));
    expect(codigo.length).toBeGreaterThan(0);
    for (const arquivo of codigo) {
      expect(readFileSync(arquivo, "utf8")).not.toContain(NOME_PERFIL);
    }
  });
});
