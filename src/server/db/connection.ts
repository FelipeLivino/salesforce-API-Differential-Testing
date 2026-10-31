import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrate";

export type Db = Database.Database;

const DEFAULT_DATABASE_PATH = path.join("data", "app.db");
const MEMORY = ":memory:";

/** DATABASE_PATH é opcional fora do Docker. Sem ela, usa `data/app.db`, ignorado pelo Git. */
export function resolveDatabasePath(env: Record<string, string | undefined> = process.env): string {
  const configured = env.DATABASE_PATH?.trim();
  if (configured === MEMORY) return MEMORY;
  return path.resolve(/*turbopackIgnore: true*/ configured || DEFAULT_DATABASE_PATH);
}

export interface OpenDatabaseOptions {
  /** Padrão: DATABASE_PATH. */
  path?: string;
  /** Padrão: a pasta de migrações do projeto. */
  migrationsDir?: string;
}

/** Abre uma nova conexão e aplica as migrações pendentes. Quem abre é quem fecha. */
export function openDatabase(options: OpenDatabaseOptions = {}): Db {
  const databasePath = options.path ?? resolveDatabasePath();
  if (databasePath !== MEMORY) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const db = new Database(databasePath);
  try {
    db.pragma("foreign_keys = ON");
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    runMigrations(db, options.migrationsDir);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

// Em globalThis para que bundles separados e o hot reload usem a mesma conexão.
const holder = globalThis as typeof globalThis & { __salesforceDtDb?: Db };

/** Conexão única do processo, aberta no primeiro uso. */
export function getDatabase(): Db {
  holder.__salesforceDtDb ??= openDatabase();
  return holder.__salesforceDtDb;
}

/** Fecha a conexão única. O próximo `getDatabase` abre outra. */
export function closeDatabase(): void {
  holder.__salesforceDtDb?.close();
  delete holder.__salesforceDtDb;
}
