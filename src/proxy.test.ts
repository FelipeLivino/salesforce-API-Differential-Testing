import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

function pedido(headers: Record<string, string>): Request {
  // O construtor de Request do Node não bloqueia estes cabeçalhos.
  return new Request("http://127.0.0.1:3000/api/ambientes", { headers });
}

const status = (headers: Record<string, string>) => proxy(pedido(headers))?.status;

describe("proxy contra DNS rebinding (A1)", () => {
  it.each(["localhost", "localhost:3000", "LOCALHOST:3000", "127.0.0.1", "127.0.0.1:49152", "[::1]", "[::1]:3000"])(
    "aceita Host %s, comparando só o hostname",
    (host) => {
      expect(proxy(pedido({ host }))).toBeUndefined();
    },
  );

  it.each([
    "evil.example",
    "evil.example:3000",
    "localhost.evil.example",
    "127.0.0.1.nip.io",
    "evil.example@localhost",
    "localhost@evil.example",
    "localhost/evil",
    "192.168.0.10:3000",
    "",
  ])("recusa Host '%s' com 403", (host) => {
    expect(status({ host })).toBe(403);
  });

  it("recusa pedido sem Host", () => {
    expect(status({})).toBe(403);
  });

  it.each(["http://localhost:9999", "https://127.0.0.1", "http://[::1]:3000"])("aceita Origin %s", (origin) => {
    expect(proxy(pedido({ host: "127.0.0.1:3000", origin }))).toBeUndefined();
  });

  it.each(["https://evil.example", "http://localhost.evil.example", "null", "não é url"])(
    "recusa Origin '%s' com 403, mesmo com Host local",
    (origin) => {
      expect(status({ host: "127.0.0.1:3000", origin: encodeURI(origin) })).toBe(403);
    },
  );

  it("responde JSON no formato de erro da API, sem repetir o valor recebido", async () => {
    const resposta = proxy(pedido({ host: "SENTINELA.evil.example" }))!;
    const texto = await resposta.text();
    expect(resposta.headers.get("content-type")).toContain("application/json");
    expect(JSON.parse(texto)).toMatchObject({ erro: { codigo: "HOST_RECUSADO" } });
    expect(texto).not.toContain("SENTINELA");
  });

  it("o healthcheck do Compose continua aceito", () => {
    // docker-compose.yml chama http://127.0.0.1:3000/ com fetch, sem Origin.
    expect(proxy(pedido({ host: "127.0.0.1:3000" }))).toBeUndefined();
  });
});
