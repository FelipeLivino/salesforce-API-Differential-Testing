import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Database } from "better-sqlite3";

// Relativo à raiz do projeto: em build do Next, import.meta.url aponta para .next.
export const DEFAULT_MIGRATIONS_DIR = path.join(process.cwd(), "src", "server", "db", "migrations");

const FILE_NAME = /^(\d{3})_[a-z0-9_]+\.sql$/;

interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

interface AppliedMigration {
  versao: number;
  nome: string;
  checksum: string;
}

function loadMigrations(dir: string): Migration[] {
  let fileNames: string[];
  try {
    fileNames = readdirSync(dir).filter((name) => name.endsWith(".sql"));
  } catch (cause) {
    throw new Error(`Pasta de migrações não encontrada: ${dir}`, { cause });
  }
  if (fileNames.length === 0) {
    throw new Error(`Nenhuma migração encontrada em: ${dir}`);
  }

  const migrations = fileNames
    .map((name): Migration => {
      const match = FILE_NAME.exec(name);
      if (!match) {
        throw new Error(`Nome de migração inválido: ${name}. Use NNN_nome.sql.`);
      }
      const sql = readFileSync(path.join(dir, name), "utf8");
      return {
        version: Number(match[1]),
        name,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    })
    .sort((a, b) => a.version - b.version);

  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(
        `Sequência de migrações inválida em ${migration.name}: esperada a versão ${index + 1}.`,
      );
    }
  });
  return migrations;
}

/**
 * Aplica as migrações pendentes e devolve os nomes das aplicadas nesta chamada.
 *
 * Tudo roda em uma única transação IMMEDIATE: se algo falhar, o banco fica como estava,
 * e dois processos não aplicam a mesma migração. Por isso, um arquivo de migração não
 * pode conter BEGIN, COMMIT ou ROLLBACK próprios.
 */
export function runMigrations(db: Database, dir: string = DEFAULT_MIGRATIONS_DIR): string[] {
  const migrations = loadMigrations(dir);

  const run = db.transaction((): string[] => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS migracoes (
        versao      INTEGER PRIMARY KEY,
        nome        TEXT NOT NULL,
        checksum    TEXT NOT NULL,
        aplicada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ) STRICT
    `);

    const applied = db
      .prepare("SELECT versao, nome, checksum FROM migracoes ORDER BY versao")
      .all() as AppliedMigration[];
    for (const row of applied) {
      const migration = migrations[row.versao - 1];
      if (!migration) {
        throw new Error(`O banco tem a migração ${row.nome}, que não existe nesta versão do código.`);
      }
      if (migration.checksum !== row.checksum) {
        throw new Error(`A migração ${row.nome} mudou depois de aplicada. Crie uma nova migração.`);
      }
    }

    const pending = migrations.slice(applied.length);
    const record = db.prepare("INSERT INTO migracoes (versao, nome, checksum) VALUES (?, ?, ?)");
    for (const migration of pending) {
      db.exec(migration.sql);
      if (!db.inTransaction) {
        throw new Error(`A migração ${migration.name} não pode encerrar a transação.`);
      }
      record.run(migration.version, migration.name, migration.checksum);
    }

    if ((db.pragma("foreign_key_check") as unknown[]).length > 0) {
      throw new Error("As migrações deixaram o banco com referências inválidas.");
    }
    return pending.map((migration) => migration.name);
  });

  return run.immediate();
}
