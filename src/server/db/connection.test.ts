import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, getDatabase, openDatabase, resolveDatabasePath, type Db } from "./connection";

// Valores fictícios: já "cifrados" do ponto de vista do banco, que não interpreta o conteúdo.
const CIFRADO = "v1.iv-ficticio.tag-ficticia.valor-ficticio";

function insertApp(db: Db): number {
  return Number(db.prepare("INSERT INTO apps_oauth (client_id) VALUES ('client-ficticio')").run().lastInsertRowid);
}

function insertAmbiente(db: Db, appId = insertApp(db)): number {
  return Number(
    db
      .prepare("INSERT INTO ambientes (url, tipo, app_oauth_id) VALUES ('https://exemplo.test', 'sandbox', ?)")
      .run(appId).lastInsertRowid,
  );
}

function insertPerfil(db: Db, nome = "perfil-do-teste", tipoLogin = "tipo-do-teste"): number {
  return Number(
    db.prepare("INSERT INTO perfis (nome, tipo_login) VALUES (?, ?)").run(nome, tipoLogin).lastInsertRowid,
  );
}

function insertContexto(db: Db, ambienteId: number, perfilId: number): number {
  return Number(
    db
      .prepare(
        `INSERT INTO contextos (ambiente_id, perfil_id, url, login, senha_cifrada)
         VALUES (?, ?, 'https://site.exemplo.test', 'login-ficticio', ?)`,
      )
      .run(ambienteId, perfilId, CIFRADO).lastInsertRowid,
  );
}

const count = (db: Db, table: string): number =>
  (db.prepare(`SELECT count(*) AS total FROM ${table}`).get() as { total: number }).total;

describe("resolveDatabasePath", () => {
  it("usa DATABASE_PATH", () => {
    expect(resolveDatabasePath({ DATABASE_PATH: "/app/data/app.db" })).toBe("/app/data/app.db");
    expect(resolveDatabasePath({ DATABASE_PATH: "rel/x.db" })).toBe(path.resolve("rel/x.db"));
    expect(resolveDatabasePath({ DATABASE_PATH: ":memory:" })).toBe(":memory:");
  });

  it("usa data/app.db quando DATABASE_PATH está ausente ou vazia", () => {
    const padrao = path.resolve("data/app.db");
    expect(resolveDatabasePath({})).toBe(padrao);
    expect(resolveDatabasePath({ DATABASE_PATH: "  " })).toBe(padrao);
  });
});

describe("banco em arquivo", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "banco-"));
  });

  afterEach(() => {
    closeDatabase();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("cria a pasta, migra e mantém os dados ao reabrir sem reaplicar", () => {
    const file = path.join(dir, "sub", "pasta", "app.db");

    const first = openDatabase({ path: file });
    const perfilId = insertPerfil(first);
    expect(first.pragma("journal_mode", { simple: true })).toBe("wal");
    first.close();
    expect(existsSync(file)).toBe(true);

    const second = openDatabase({ path: file });
    try {
      expect(second.prepare("SELECT id FROM perfis").all()).toEqual([{ id: perfilId }]);
      expect(count(second, "migracoes")).toBe(1);
      expect(second.pragma("foreign_keys", { simple: true })).toBe(1);
    } finally {
      second.close();
    }
  });

  it("getDatabase abre o caminho de DATABASE_PATH e reaproveita a conexão", () => {
    const file = path.join(dir, "env.db");
    vi.stubEnv("DATABASE_PATH", file);

    const db = getDatabase();
    expect(db.name).toBe(file);
    expect(getDatabase()).toBe(db);

    closeDatabase();
    expect(db.open).toBe(false);
    expect(getDatabase()).not.toBe(db);
  });

  it("fecha a conexão e propaga o erro quando a migração falha", () => {
    const close = vi.spyOn(Database.prototype, "close");
    const options = { path: path.join(dir, "falha.db"), migrationsDir: path.join(dir, "ausente") };
    expect(() => openDatabase(options)).toThrow(/não encontrada/);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("esquema da migração 001 em banco vazio", () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
  });

  afterEach(() => {
    db.close();
  });

  it("cria as tabelas, e a base nova não tem nenhum cadastro", () => {
    for (const table of ["apps_oauth", "ambientes", "perfis", "contextos"]) {
      expect(count(db, table)).toBe(0);
    }
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
  });

  it("guarda segredos só em colunas de valor cifrado, sem coluna de token de acesso", () => {
    const columns = (table: string) =>
      (db.pragma(`table_info(${table})`) as { name: string }[]).map((column) => column.name);

    expect(columns("apps_oauth")).toContain("client_secret_cifrado");
    expect(columns("contextos")).toEqual(
      expect.arrayContaining(["senha_cifrada", "security_token_cifrado"]),
    );

    const all = ["apps_oauth", "ambientes", "perfis", "contextos"].flatMap(columns);
    const sensitive = all.filter((name) => /senha|secret|token/i.test(name));
    expect(sensitive.sort()).toEqual(["client_secret_cifrado", "security_token_cifrado", "senha_cifrada"]);
  });

  it("aceita qualquer quantidade de perfis, com nome e tipo de login livres", () => {
    for (let i = 1; i <= 6; i += 1) {
      insertPerfil(db, `nome-arbitrario-${i}`, `tipo-arbitrario-${i}`);
    }
    expect(count(db, "perfis")).toBe(6);
    const row = db.prepare("SELECT situacao FROM perfis LIMIT 1").get() as { situacao: string };
    expect(row.situacao).toBe("ativo");
  });

  it("recusa campos obrigatórios vazios e situação ou tipo inválidos", () => {
    expect(() => insertPerfil(db, "  ")).toThrow(/CHECK/);
    expect(() => insertPerfil(db, "nome", "")).toThrow(/CHECK/);
    expect(() => db.prepare("INSERT INTO perfis (nome, tipo_login, situacao) VALUES ('n', 't', 'x')").run()).toThrow(
      /CHECK/,
    );
    expect(() => db.prepare("INSERT INTO apps_oauth (client_id) VALUES ('')").run()).toThrow(/CHECK/);
    expect(() => db.prepare("INSERT INTO apps_oauth (client_id) VALUES (NULL)").run()).toThrow(/NOT NULL/);
    expect(() =>
      db.prepare("INSERT INTO ambientes (url, tipo, app_oauth_id) VALUES ('https://x.test', 'homologacao', ?)").run(insertApp(db)),
    ).toThrow(/CHECK/);
    expect(() =>
      db.prepare("INSERT INTO ambientes (url, tipo, app_oauth_id) VALUES ('https://x.test', 'producao', NULL)").run(),
    ).toThrow(/NOT NULL/);
  });

  it("aceita Client Secret e security token ausentes, mas exige senha", () => {
    const appId = insertApp(db);
    const ambienteId = insertAmbiente(db, appId);
    const perfilId = insertPerfil(db);
    const contextoId = insertContexto(db, ambienteId, perfilId);

    expect(db.prepare("SELECT client_secret_cifrado AS v FROM apps_oauth WHERE id = ?").get(appId)).toEqual({ v: null });
    expect(db.prepare("SELECT security_token_cifrado AS v, senha_cifrada AS s FROM contextos WHERE id = ?").get(contextoId)).toEqual({
      v: null,
      s: CIFRADO,
    });

    expect(() =>
      db
        .prepare("INSERT INTO contextos (ambiente_id, perfil_id, url, login, senha_cifrada) VALUES (?, ?, 'u', 'l', NULL)")
        .run(ambienteId, perfilId),
    ).toThrow(/NOT NULL/);
    expect(() =>
      db
        .prepare("INSERT INTO contextos (ambiente_id, perfil_id, url, login, senha_cifrada) VALUES (?, ?, 'u', 'l', '')")
        .run(ambienteId, perfilId),
    ).toThrow(/CHECK/);
    expect(() => db.prepare("UPDATE apps_oauth SET client_secret_cifrado = '' WHERE id = ?").run(appId)).toThrow(/CHECK/);
  });

  describe("integridade referencial", () => {
    it("recusa contexto com ambiente ou perfil inexistente", () => {
      const ambienteId = insertAmbiente(db);
      const perfilId = insertPerfil(db);
      expect(() => insertContexto(db, 999, perfilId)).toThrow(/FOREIGN KEY/);
      expect(() => insertContexto(db, ambienteId, 999)).toThrow(/FOREIGN KEY/);
      expect(count(db, "contextos")).toBe(0);
    });

    it("recusa ambiente com app inexistente ou com app de outro ambiente", () => {
      expect(() => insertAmbiente(db, 999)).toThrow(/FOREIGN KEY/);

      const appId = insertApp(db);
      insertAmbiente(db, appId);
      expect(() => insertAmbiente(db, appId)).toThrow(/UNIQUE/);
    });

    it("impede excluir perfil ou ambiente com contexto, e libera depois", () => {
      const ambienteId = insertAmbiente(db);
      const perfilId = insertPerfil(db);
      const contextoId = insertContexto(db, ambienteId, perfilId);

      expect(() => db.prepare("DELETE FROM perfis WHERE id = ?").run(perfilId)).toThrow(/FOREIGN KEY/);
      expect(() => db.prepare("DELETE FROM ambientes WHERE id = ?").run(ambienteId)).toThrow(/FOREIGN KEY/);
      expect(count(db, "perfis")).toBe(1);
      expect(count(db, "ambientes")).toBe(1);
      expect(count(db, "apps_oauth")).toBe(1);

      // Perfil com contexto continua existindo como arquivado.
      db.prepare("UPDATE perfis SET situacao = 'arquivado' WHERE id = ?").run(perfilId);
      expect(count(db, "contextos")).toBe(1);

      db.prepare("DELETE FROM contextos WHERE id = ?").run(contextoId);
      db.prepare("DELETE FROM perfis WHERE id = ?").run(perfilId);
      db.prepare("DELETE FROM ambientes WHERE id = ?").run(ambienteId);
      expect(count(db, "perfis")).toBe(0);
    });

    it("impede excluir app em uso, e remove o app junto com o ambiente", () => {
      const appId = insertApp(db);
      const ambienteId = insertAmbiente(db, appId);

      expect(() => db.prepare("DELETE FROM apps_oauth WHERE id = ?").run(appId)).toThrow(/FOREIGN KEY/);

      db.prepare("DELETE FROM ambientes WHERE id = ?").run(ambienteId);
      expect(count(db, "apps_oauth")).toBe(0);
    });

    it("não reaproveita id de contexto excluído, que é a chave do cache de tokens", () => {
      const ambienteId = insertAmbiente(db);
      const perfilId = insertPerfil(db);
      const first = insertContexto(db, ambienteId, perfilId);
      db.prepare("DELETE FROM contextos WHERE id = ?").run(first);
      expect(insertContexto(db, ambienteId, perfilId)).toBeGreaterThan(first);
    });
  });
});
