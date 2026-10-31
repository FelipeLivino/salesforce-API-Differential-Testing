import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ler = (arquivo: string) => readFileSync(path.resolve(import.meta.dirname, "../../docs", arquivo), "utf8");
const linha = (texto: string, inicio: string) => texto.split("\n").find((item) => item.startsWith(inicio)) ?? "";

describe("decisões registradas na T15", () => {
  it("F6.1 exige reaproveitamento em getToken e callWithToken, com Testar login como exceção (D3)", () => {
    const f61 = linha(ler("criterios-fase1.md"), "- **F6.1**");
    expect(f61).toContain("getToken");
    expect(f61).toContain("callWithToken");
    expect(f61).toMatch(/Testar login.*exceção/);
  });

  it("C15 está decidida, sem aguardar validação (D3)", () => {
    const c15 = linha(ler("decisoes.md"), "| C15 |");
    expect(c15).toMatch(/Decidida/);
    expect(c15).not.toMatch(/Aguarda validação/);
  });

  it("A3 e R1 estão registrados como riscos aceitos nesta fase", () => {
    const decisoes = ler("decisoes.md");
    const riscos = decisoes.slice(decisoes.indexOf("## Riscos aceitos"));
    expect(decisoes).toContain("## Riscos aceitos");
    expect(linha(riscos, "| A3 |")).not.toBe("");
    expect(linha(riscos, "| R1 |")).not.toBe("");
  });
});
