import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret } from "../crypto/secrets";
import { openDatabase, type Db } from "../db/connection";
import { createContextosRepository, createAmbientesRepository } from "../db/repositories";
import { CadastroError, createCadastros, type Cadastros } from "./index";

const SENHA = "SENTINELA-SENHA-123";
const SENHA_NOVA = "SENTINELA-SENHA-NOVA-456";
const TOKEN = "SENTINELA-TOKEN-789";
const SECRET = "SENTINELA-SECRET-012";

const AMBIENTE = {
  url: "https://exemplo.test/",
  tipo: "sandbox",
  app: { clientId: "client-ficticio", clientSecret: SECRET, redirectUri: "https://exemplo.test/cb" },
};

function erroDe(acao: () => unknown): CadastroError {
  try {
    acao();
  } catch (error) {
    if (error instanceof CadastroError) return error;
    throw error;
  }
  throw new Error("Era esperado um CadastroError.");
}

const camposDe = (acao: () => unknown) => erroDe(acao).campos?.map((campo) => campo.campo);

describe("cadastros", () => {
  let db: Db;
  let c: Cadastros;
  const tokens = { invalidate: vi.fn(), invalidateAll: vi.fn() };

  beforeEach(() => {
    vi.stubEnv("SECRETS_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    tokens.invalidate.mockReset();
    tokens.invalidateAll.mockReset();
    db = openDatabase({ path: ":memory:" });
    c = createCadastros(db, { tokens, tipoLoginValido: () => true });
  });

  afterEach(() => {
    db.close();
    vi.unstubAllEnvs();
  });

  const novoPerfil = (nome = "perfil-a") => c.perfis.criar({ nome, tipoLogin: "tipo-a" });
  const novoAmbiente = () => c.ambientes.criar(AMBIENTE);
  const novoContexto = (extra: object = {}) =>
    c.contextos.criar({
      ambienteId: novoAmbiente().id,
      perfilId: novoPerfil().id,
      url: "https://site.exemplo.test",
      login: "login-ficticio",
      senha: SENHA,
      ...extra,
    });

  describe("ambientes", () => {
    it("cria, lista e edita, cifrando o Client Secret e informando só se está definido (F2.1)", () => {
      const criado = novoAmbiente();
      expect(criado).toMatchObject({
        url: "https://exemplo.test",
        tipo: "sandbox",
        app: { clientId: "client-ficticio", redirectUri: "https://exemplo.test/cb", clientSecretDefinido: true },
      });
      expect(JSON.stringify(c.ambientes.listar())).not.toContain(SECRET);
      const gravado = createAmbientesRepository(db).buscarPorId(criado.id)!;
      expect(gravado.app.clientSecretCifrado).not.toContain(SECRET);
      expect(decryptSecret(gravado.app.clientSecretCifrado!)).toBe(SECRET);

      const editado = c.ambientes.editar(criado.id, { tipo: "producao", app: { clientId: "outro" } });
      expect(editado).toMatchObject({ url: "https://exemplo.test", tipo: "producao", app: { clientId: "outro" } });
      expect(c.ambientes.listar()).toHaveLength(1);
    });

    it("exige o Client Secret de novo quando o host do ambiente muda (A1)", () => {
      const { id } = novoAmbiente();
      const erro = erroDe(() => c.ambientes.editar(id, { url: "https://atacante.example" }));
      expect(erro.campos?.map((campo) => campo.campo)).toEqual(["app.clientSecret"]);
      expect(c.ambientes.buscar(id).url).toBe("https://exemplo.test");
      expect(camposDe(() => c.ambientes.editar(id, { url: "https://x.example:8443", app: { clientSecret: " " } }))).toEqual([
        "app.clientSecret",
      ]);

      expect(c.ambientes.editar(id, { url: "https://exemplo.test/caminho" }).url).toBe("https://exemplo.test/caminho");
      expect(c.ambientes.editar(id, { url: "https://novo.example", app: { clientSecret: "SENTINELA-NOVO" } }).url).toBe(
        "https://novo.example",
      );
    });

    it("com host novo, aceita remover o Client Secret, e não exige se nenhum está salvo (A1)", () => {
      const { id } = novoAmbiente();
      expect(c.ambientes.editar(id, { url: "https://a.example", app: { clientSecret: null } }).app.clientSecretDefinido).toBe(false);
      expect(c.ambientes.editar(id, { url: "https://b.example" }).url).toBe("https://b.example");
    });

    it.each([
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "ftp://exemplo.test/cb",
      "myapp://callback",
      "http://exemplo.test/cb",
      "http://192.168.0.10/cb",
    ])("recusa redirect URI %s (R2)", (redirectUri) => {
      const entrada = { ...AMBIENTE, app: { clientId: "x", redirectUri } };
      expect(camposDe(() => c.ambientes.criar(entrada))).toEqual(["app.redirectUri"]);
      const { id } = novoAmbiente();
      expect(camposDe(() => c.ambientes.editar(id, { app: { redirectUri } }))).toEqual(["app.redirectUri"]);
    });

    it.each(["https://exemplo.test/cb?a=1", "http://localhost:3000/cb", "http://127.0.0.1/cb", "http://[::1]:8080/cb"])(
      "aceita redirect URI %s, mantida como digitada (R2)",
      (redirectUri) => {
        const criado = c.ambientes.criar({ ...AMBIENTE, app: { clientId: "x", redirectUri } });
        expect(criado.app.redirectUri).toBe(redirectUri);
      },
    );

    it("salva sem Client Secret, e o Client ID é obrigatório (F2.2)", () => {
      const criado = c.ambientes.criar({ ...AMBIENTE, app: { clientId: "client-ficticio" } });
      expect(criado.app).toEqual({ clientId: "client-ficticio", redirectUri: null, clientSecretDefinido: false });
      expect(camposDe(() => c.ambientes.criar({ ...AMBIENTE, app: {} }))).toEqual(["app.clientId"]);
      expect(camposDe(() => c.ambientes.criar({ url: "https://x.test", tipo: "sandbox" }))).toEqual(["app.clientId"]);
    });

    it("mantém, troca e remove o Client Secret na edição", () => {
      const { id } = novoAmbiente();
      const cifrado = () => createAmbientesRepository(db).buscarPorId(id)!.app.clientSecretCifrado;
      const original = cifrado();

      c.ambientes.editar(id, { url: "https://exemplo.test/outro" });
      expect(cifrado()).toBe(original);
      c.ambientes.editar(id, { app: { clientSecret: "" } });
      expect(cifrado()).toBe(original);

      c.ambientes.editar(id, { app: { clientSecret: "SENTINELA-OUTRO" } });
      expect(decryptSecret(cifrado()!)).toBe("SENTINELA-OUTRO");

      expect(c.ambientes.editar(id, { app: { clientSecret: null } }).app.clientSecretDefinido).toBe(false);
      expect(cifrado()).toBeNull();
    });

    it("recusa tipo fora de sandbox e produção, com mensagem e sem repetir o valor (F2.3)", () => {
      const erro = erroDe(() => c.ambientes.criar({ ...AMBIENTE, tipo: "homologacao" }));
      expect(erro.codigo).toBe("VALIDACAO");
      expect(erro.campos?.[0]).toEqual({ campo: "tipo", mensagem: "Tipo inválido. Use: sandbox ou producao." });
      expect(JSON.stringify(erro.campos)).not.toContain("homologacao");
      const { id } = novoAmbiente();
      expect(camposDe(() => c.ambientes.editar(id, { tipo: "homologacao" }))).toEqual(["tipo"]);
    });

    it.each([
      ["http://exemplo.test", "http fora de loopback"],
      ["ftp://exemplo.test", "outro protocolo"],
      ["não é url", "texto"],
      ["https://usuario:SENTINELA@exemplo.test", "credenciais"],
      ["https://exemplo.test?senha=SENTINELA", "query"],
    ])("recusa a URL %s (%s), sem repetir o valor", (url) => {
      const erro = erroDe(() => c.ambientes.criar({ ...AMBIENTE, url }));
      expect(erro.campos?.[0]?.campo).toBe("url");
      expect(erro.message).not.toContain("SENTINELA");
    });

    it.each(["http://127.0.0.1:4010", "http://localhost:4010", "http://[::1]:4010"])(
      "aceita http em loopback: %s",
      (url) => {
        expect(c.ambientes.criar({ ...AMBIENTE, url }).url).toBe(url);
      },
    );

    it("editar invalida todos os tokens", () => {
      c.ambientes.editar(novoAmbiente().id, { url: "https://outra.test", app: { clientSecret: SECRET } });
      expect(tokens.invalidateAll).toHaveBeenCalledTimes(1);
    });
  });

  describe("perfis", () => {
    it("base nova não tem perfis, e não há limite de quantidade (F2.5)", () => {
      expect(c.perfis.listar()).toEqual([]);
      for (let i = 1; i <= 6; i += 1) novoPerfil(`nome-livre-${i}`);
      expect(c.perfis.listar().map((perfil) => perfil.nome)).toContain("nome-livre-6");
    });

    it("cria e edita nome, descrição, tipo de login e situação (F2.4)", () => {
      const criado = c.perfis.criar({ nome: " n ", descricao: "d", tipoLogin: "qualquer-tipo" });
      expect(criado).toMatchObject({ nome: "n", descricao: "d", tipoLogin: "qualquer-tipo", situacao: "ativo" });

      const editado = c.perfis.editar(criado.id, { nome: "m", descricao: "", tipoLogin: "t2", situacao: "arquivado" });
      expect(editado).toMatchObject({ nome: "m", descricao: null, tipoLogin: "t2", situacao: "arquivado" });
      expect(c.perfis.editar(criado.id, { situacao: "ativo" }).situacao).toBe("ativo");
      expect(camposDe(() => c.perfis.editar(criado.id, { situacao: "x" }))).toEqual(["situacao"]);
    });

    it("com contexto vinculado, arquiva em vez de excluir (F2.7)", () => {
      const { perfilId } = novoContexto();
      expect(c.perfis.buscar(perfilId).possuiContextos).toBe(true);

      const resposta = c.perfis.remover(perfilId);
      expect(resposta).toMatchObject({ resultado: "arquivado", perfil: { id: perfilId, situacao: "arquivado" } });
      expect(c.perfis.buscar(perfilId).situacao).toBe("arquivado");
      expect(tokens.invalidateAll).toHaveBeenCalled();
    });

    it("sem contexto, exclui (F2.8)", () => {
      const { id } = novoPerfil();
      expect(c.perfis.remover(id)).toEqual({ resultado: "excluido" });
      expect(erroDe(() => c.perfis.buscar(id)).codigo).toBe("NAO_ENCONTRADO");
      expect(erroDe(() => c.perfis.remover(id)).codigo).toBe("NAO_ENCONTRADO");
    });

    it("valida o tipo de login pela porta, só quando ele muda", () => {
      const registrados = new Set(["tipo-a"]);
      const comRegistro = createCadastros(db, { tokens, tipoLoginValido: (t) => registrados.has(t) });
      const perfil = comRegistro.perfis.criar({ nome: "n", tipoLogin: "tipo-a" });
      expect(camposDe(() => comRegistro.perfis.criar({ nome: "n", tipoLogin: "sem-adaptador" }))).toEqual(["tipoLogin"]);
      expect(camposDe(() => comRegistro.perfis.editar(perfil.id, { tipoLogin: "sem-adaptador" }))).toEqual(["tipoLogin"]);

      registrados.clear();
      expect(comRegistro.perfis.editar(perfil.id, { nome: "m", tipoLogin: "tipo-a" }).nome).toBe("m");
    });
  });

  describe("contextos", () => {
    const repo = () => createContextosRepository(db);

    it("cria, lista e edita, informando só se os segredos estão definidos (F2.9)", () => {
      const criado = novoContexto({ securityToken: TOKEN });
      expect(criado).toMatchObject({
        url: "https://site.exemplo.test",
        login: "login-ficticio",
        senhaDefinida: true,
        securityTokenDefinido: true,
        situacao: "ativo",
      });
      const texto = JSON.stringify([criado, c.contextos.listar(), c.contextos.buscar(criado.id)]);
      expect(texto).not.toContain(SENHA);
      expect(texto).not.toContain(TOKEN);
      expect(texto).not.toContain("senhaCifrada");

      expect(c.contextos.editar(criado.id, { login: "outro" }).login).toBe("outro");
    });

    it("recusa campo obrigatório vazio e indica todos os campos (F2.10)", () => {
      const erro = erroDe(() => c.contextos.criar({ url: " ", login: "", senha: "   " }));
      expect(erro.campos?.map((campo) => campo.campo)).toEqual(["ambienteId", "perfilId", "url", "login", "senha"]);
      expect(erro.message).toContain("Senha é obrigatória.");
      expect(erro.message).toContain("URL é obrigatória.");
      expect(erro.message).toContain("Login é obrigatório.");
      expect(camposDe(() => c.perfis.criar({}))).toEqual(["nome", "tipoLogin"]);
      expect(camposDe(() => c.ambientes.criar({}))).toEqual(["url", "tipo", "app.clientId"]);
    });

    it("exige a senha de novo quando o host do contexto muda (A1)", () => {
      const criado = novoContexto();
      const erro = erroDe(() => c.contextos.editar(criado.id, { url: "https://atacante.example" }));
      expect(erro.codigo).toBe("VALIDACAO");
      expect(erro.campos?.map((campo) => campo.campo)).toEqual(["senha"]);
      expect(erro.message).toContain("senha de novo");
      expect(c.contextos.buscar(criado.id).url).toBe("https://site.exemplo.test");

      for (const senha of ["", "   "]) {
        expect(camposDe(() => c.contextos.editar(criado.id, { url: "https://site.exemplo.test:8443", senha }))).toEqual(["senha"]);
      }
      expect(c.contextos.editar(criado.id, { url: "https://atacante.example", senha: SENHA_NOVA }).url).toBe(
        "https://atacante.example",
      );
    });

    it("não exige a senha quando só o caminho da URL muda (A1)", () => {
      const criado = novoContexto();
      expect(c.contextos.editar(criado.id, { url: "https://SITE.exemplo.test/portal/" }).url).toBe(
        "https://site.exemplo.test/portal",
      );
    });

    it("recusa ambiente ou perfil inexistente", () => {
      expect(
        camposDe(() =>
          c.contextos.criar({ ambienteId: 999, perfilId: 998, url: "https://x.test", login: "l", senha: SENHA }),
        ),
      ).toEqual(["ambienteId", "perfilId"]);
    });

    it("editar sem senha nova mantém a atual, intacta (F2.11)", () => {
      const { id } = novoContexto();
      const original = repo().buscarPorId(id)!.senhaCifrada;

      for (const alteracao of [{ login: "novo" }, { senha: "" }, { senha: "  " }]) {
        c.contextos.editar(id, alteracao);
        expect(repo().buscarPorId(id)!.senhaCifrada).toBe(original);
      }
      expect(decryptSecret(original)).toBe(SENHA);
    });

    it("editar sem senha nova funciona mesmo sem chave, pois nada é cifrado", () => {
      const { id } = novoContexto();
      vi.stubEnv("SECRETS_ENCRYPTION_KEY", "");
      expect(c.contextos.editar(id, { login: "novo" }).login).toBe("novo");
    });

    it("troca a senha, recusa removê-la e invalida o token do contexto", () => {
      const { id } = novoContexto();
      c.contextos.editar(id, { senha: SENHA_NOVA });
      expect(decryptSecret(repo().buscarPorId(id)!.senhaCifrada)).toBe(SENHA_NOVA);
      expect(tokens.invalidate).toHaveBeenCalledWith(id);
      expect(camposDe(() => c.contextos.editar(id, { senha: null }))).toEqual(["senha"]);
    });

    it("mantém, troca e remove o security token", () => {
      const { id } = novoContexto({ securityToken: TOKEN });
      const atual = () => repo().buscarPorId(id)!.securityTokenCifrado;
      const original = atual();

      c.contextos.editar(id, { securityToken: "" });
      expect(atual()).toBe(original);
      expect(decryptSecret(original!)).toBe(TOKEN);

      expect(c.contextos.editar(id, { securityToken: null }).securityTokenDefinido).toBe(false);
      expect(atual()).toBeNull();
    });

    it("mesma senha gera valores cifrados diferentes, e o original é recuperado (F3.2, F3.3)", () => {
      const a = repo().buscarPorId(novoContexto().id)!.senhaCifrada;
      const b = repo().buscarPorId(novoContexto().id)!.senhaCifrada;
      expect(a).not.toBe(b);
      expect(decryptSecret(a)).toBe(SENHA);
      expect(decryptSecret(b)).toBe(SENHA);
    });

    it("grava a senha sem alteração, com os espaços", () => {
      const { id } = novoContexto({ senha: "  com espaços  " });
      expect(decryptSecret(repo().buscarPorId(id)!.senhaCifrada)).toBe("  com espaços  ");
    });

    it("perfil arquivado não recebe contexto novo, mas o existente continua editável", () => {
      const contexto = novoContexto();
      c.perfis.remover(contexto.perfilId);

      const entrada = {
        ambienteId: contexto.ambienteId,
        perfilId: contexto.perfilId,
        url: "https://x.test",
        login: "l",
        senha: SENHA,
      };
      expect(erroDe(() => c.contextos.criar(entrada)).codigo).toBe("CONFLITO");
      expect(c.contextos.editar(contexto.id, { perfilId: contexto.perfilId, login: "novo" }).login).toBe("novo");

      const outro = novoContexto();
      expect(erroDe(() => c.contextos.editar(outro.id, { perfilId: contexto.perfilId })).codigo).toBe("CONFLITO");
    });

    it("arquiva o contexto pela situação", () => {
      const { id } = novoContexto();
      expect(c.contextos.editar(id, { situacao: "arquivado" }).situacao).toBe("arquivado");
    });
  });

  describe.each([
    ["ausente", ""],
    ["inválida", "curta"],
  ])("com chave %s (F3.6)", (_nome, chave) => {
    it("avisa o motivo e não grava nenhum segredo", () => {
      const ambienteId = c.ambientes.criar({ ...AMBIENTE, app: { clientId: "x" } }).id;
      const perfilId = novoPerfil().id;
      vi.stubEnv("SECRETS_ENCRYPTION_KEY", chave);

      const entrada = { ambienteId, perfilId, url: "https://x.test", login: "l", senha: SENHA };
      expect(() => c.contextos.criar(entrada)).toThrow(/SECRETS_ENCRYPTION_KEY/);
      expect(() => c.ambientes.criar(AMBIENTE)).toThrow(/SECRETS_ENCRYPTION_KEY/);
      expect(c.contextos.listar()).toEqual([]);
      expect(c.ambientes.listar()).toHaveLength(1);
    });
  });
});

describe("arquivos do SQLite", () => {
  it("não contêm os segredos-sentinela em texto puro (F3.1)", () => {
    vi.stubEnv("SECRETS_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    const dir = mkdtempSync(path.join(tmpdir(), "cadastros-"));
    const db = openDatabase({ path: path.join(dir, "app.db") });
    try {
      const c = createCadastros(db, {
        tokens: { invalidate() {}, invalidateAll() {} },
        tipoLoginValido: () => true,
      });
      const ambiente = c.ambientes.criar(AMBIENTE);
      const perfil = c.perfis.criar({ nome: "n", tipoLogin: "t" });
      c.contextos.criar({
        ambienteId: ambiente.id,
        perfilId: perfil.id,
        url: "https://x.test",
        login: "login-visivel",
        senha: SENHA,
        securityToken: TOKEN,
      });

      const conteudo = () =>
        readdirSync(dir)
          .filter((nome) => statSync(path.join(dir, nome)).isFile())
          .map((nome) => readFileSync(path.join(dir, nome)).toString("latin1"))
          .join("");
      // Confere que a busca enxerga o conteúdo gravado, para não passar por engano.
      expect(conteudo()).toContain("login-visivel");
      for (const sentinela of [SENHA, TOKEN, SECRET, process.env.SECRETS_ENCRYPTION_KEY!]) {
        expect(conteudo()).not.toContain(sentinela);
      }
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });
});
