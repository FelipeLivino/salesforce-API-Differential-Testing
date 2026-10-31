import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MIGRATIONS_DIR, runMigrations } from "./migrate";

const tableNames = (db: Database.Database): string[] =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((row) => row.name);

describe("runMigrations", () => {
  let dir: string;
  let db: Database.Database;

  const writeMigration = (name: string, sql: string) => writeFileSync(path.join(dir, name), sql);

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "migracoes-"));
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("aplica as migrações do projeto em banco vazio e não reaplica", () => {
    expect(runMigrations(db)).toEqual(["001_cadastros.sql"]);
    expect(runMigrations(db)).toEqual([]);
    expect(runMigrations(db)).toEqual([]);

    const rows = db.prepare("SELECT versao, nome FROM migracoes").all();
    expect(rows).toEqual([{ versao: 1, nome: "001_cadastros.sql" }]);
    expect(DEFAULT_MIGRATIONS_DIR.endsWith(path.join("src", "server", "db", "migrations"))).toBe(true);
  });

  it("aplica em ordem numérica e, depois, só o que está pendente", () => {
    writeMigration("002_b.sql", "CREATE TABLE b (a_id INTEGER REFERENCES a (id));");
    writeMigration("001_a.sql", "CREATE TABLE a (id INTEGER PRIMARY KEY);");
    expect(runMigrations(db, dir)).toEqual(["001_a.sql", "002_b.sql"]);

    writeMigration("003_c.sql", "CREATE TABLE c (id INTEGER PRIMARY KEY);");
    expect(runMigrations(db, dir)).toEqual(["003_c.sql"]);
    expect(tableNames(db)).toEqual(expect.arrayContaining(["a", "b", "c"]));
  });

  it("desfaz tudo quando uma migração falha, e pode aplicar depois de corrigida", () => {
    writeMigration("001_a.sql", "CREATE TABLE a (id INTEGER PRIMARY KEY);");
    writeMigration("002_b.sql", "CREATE TABLE b (id INTEGER PRIMARY KEY); ISTO NAO E SQL;");

    expect(() => runMigrations(db, dir)).toThrow();
    expect(tableNames(db)).toEqual([]);
    expect(db.inTransaction).toBe(false);

    writeMigration("002_b.sql", "CREATE TABLE b (id INTEGER PRIMARY KEY);");
    expect(runMigrations(db, dir)).toEqual(["001_a.sql", "002_b.sql"]);
  });

  it("recusa migração alterada depois de aplicada", () => {
    writeMigration("001_a.sql", "CREATE TABLE a (id INTEGER PRIMARY KEY);");
    runMigrations(db, dir);

    writeMigration("001_a.sql", "CREATE TABLE a (id INTEGER PRIMARY KEY, x TEXT);");
    expect(() => runMigrations(db, dir)).toThrow(/001_a\.sql mudou/);
  });

  it("recusa banco com migração que não existe no código", () => {
    writeMigration("001_a.sql", "CREATE TABLE a (id INTEGER PRIMARY KEY);");
    writeMigration("002_b.sql", "CREATE TABLE b (id INTEGER PRIMARY KEY);");
    runMigrations(db, dir);

    rmSync(path.join(dir, "002_b.sql"));
    expect(() => runMigrations(db, dir)).toThrow(/002_b\.sql, que não existe/);
  });

  it("recusa migração que encerra a transação", () => {
    writeMigration("001_a.sql", "CREATE TABLE a (id INTEGER PRIMARY KEY); COMMIT;");
    expect(() => runMigrations(db, dir)).toThrow(/não pode encerrar a transação/);
  });

  it("recusa migração que deixa referência inválida", () => {
    writeMigration(
      "001_a.sql",
      `CREATE TABLE a (id INTEGER PRIMARY KEY);
       CREATE TABLE b (a_id INTEGER REFERENCES a (id));
       INSERT INTO b (a_id) VALUES (999);`,
    );
    // Com a verificação imediata desligada, só a checagem final do executor detecta.
    db.pragma("foreign_keys = OFF");
    expect(() => runMigrations(db, dir)).toThrow(/referências inválidas/);
    expect(tableNames(db)).toEqual([]);
  });

  it.each([
    ["nome fora do padrão", "1_a.sql", /Nome de migração inválido/],
    ["versão inicial errada", "002_a.sql", /esperada a versão 1/],
  ])("recusa %s", (_caso, name, message) => {
    writeMigration(name, "SELECT 1;");
    expect(() => runMigrations(db, dir)).toThrow(message);
  });

  it("recusa versão repetida e lacuna na sequência", () => {
    writeMigration("001_a.sql", "SELECT 1;");
    writeMigration("001_b.sql", "SELECT 1;");
    expect(() => runMigrations(db, dir)).toThrow(/esperada a versão 2/);

    rmSync(path.join(dir, "001_b.sql"));
    writeMigration("003_c.sql", "SELECT 1;");
    expect(() => runMigrations(db, dir)).toThrow(/esperada a versão 2/);
  });

  it("falha com motivo claro quando a pasta não existe ou está vazia", () => {
    expect(() => runMigrations(db, dir)).toThrow(/Nenhuma migração encontrada/);
    expect(() => runMigrations(db, path.join(dir, "ausente"))).toThrow(/não encontrada/);
  });
});
