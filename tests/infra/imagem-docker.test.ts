import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(import.meta.dirname, "../..");

function arquivos(pasta: string): string[] {
  return readdirSync(path.join(RAIZ, pasta), { withFileTypes: true, recursive: true })
    .filter((item) => item.isFile())
    .map((item) => path.relative(RAIZ, path.join(item.parentPath, item.name)));
}

/** Subconjunto da sintaxe do .dockerignore usado neste projeto: `*`, `**` e pastas inteiras. */
function ignorados(): RegExp[] {
  return readFileSync(path.join(RAIZ, ".dockerignore"), "utf8")
    .split("\n")
    .map((linha) => linha.trim())
    .filter((linha) => linha !== "" && !linha.startsWith("#"))
    .map((padrao) => {
      const corpo = padrao
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*\//g, "\u0000")
        .replace(/\*/g, "[^/]*")
        .replace(/\u0000/g, "(?:.*/)?");
      return new RegExp(`^${corpo}(?:/.*)?$`);
    });
}

describe("contexto de build da imagem Docker (D1)", () => {
  const padroes = ignorados();
  const noContexto = [...arquivos("src"), ...arquivos("tests")].filter(
    (arquivo) => !padroes.some((padrao) => padrao.test(arquivo)),
  );

  it("não leva testes para o contexto", () => {
    expect(noContexto.filter((arquivo) => /\.test\.tsx?$|^tests\//.test(arquivo))).toEqual([]);
  });

  it("nenhum arquivo do contexto importa de tests/, o que quebraria a checagem de tipos do next build", () => {
    const quebrados = noContexto.filter(
      (arquivo) =>
        /\.tsx?$/.test(arquivo) &&
        /from\s+["'][^"']*\/?tests\/[^"']*["']/.test(readFileSync(path.join(RAIZ, arquivo), "utf8")),
    );
    expect(quebrados).toEqual([]);
  });

  it("o estágio final copia de src só as migrações", () => {
    const final = readFileSync(path.join(RAIZ, "Dockerfile"), "utf8").split(/^FROM base AS runner$/m)[1]!;
    const copias = final.split("\n").filter((linha) => linha.startsWith("COPY"));
    expect(copias.filter((linha) => /\bsrc\b/.test(linha))).toEqual([
      "COPY src/server/db/migrations ./src/server/db/migrations",
    ]);
    expect(copias.some((linha) => /^COPY \. /.test(linha) || /\btests\b/.test(linha))).toBe(false);
  });
});
