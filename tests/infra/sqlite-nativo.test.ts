import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

describe("ambiente de testes", () => {
  it("carrega o módulo nativo do SQLite em memória", () => {
    const db = new Database(":memory:");
    try {
      const row = db.prepare("SELECT 1 + 1 AS total").get() as { total: number };
      expect(row.total).toBe(2);
    } finally {
      db.close();
    }
  });
});
