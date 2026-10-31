import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FakeSalesforce, startFakeSalesforce } from "../../../tests/fake-salesforce/server";
import { tokenDestinationProblem, getWithBearer, isFailure, MAX_RESPONSE_BYTES, postForm } from "./oauth-http";

describe("tokenDestinationProblem (A2)", () => {
  const SITE = "https://empresa.example.com";

  it.each([
    [SITE, `${SITE}/portal`],
    [SITE, "https://empresa.my.site.com/portal"],
    [SITE, "https://empresa.my.salesforce.com"],
    [SITE, "https://empresa.lightning.force.com"],
    ["http://127.0.0.1:4000", "http://127.0.0.1:4000/site"],
    ["http://127.0.0.1:4000", "http://localhost:5000"],
    ["https://localhost:4000", "http://[::1]:5000"],
  ])("com login em %s, aceita %s", (login, comunidade) => {
    expect(tokenDestinationProblem(comunidade, login)).toBeNull();
  });

  it.each([
    [SITE, "https://atacante.example"],
    [SITE, "https://empresa.example.com:8443"],
    [SITE, "http://empresa.my.site.com"],
    [SITE, "https://evilsalesforce.com"],
    [SITE, "https://salesforce.com.evil.example"],
    [SITE, "https://force.com"],
    [SITE, "http://127.0.0.1:4000"],
    [SITE, "http://localhost:4000"],
    [SITE, "https://localhost"],
    [SITE, "https://[::1]"],
    ["http://127.0.0.1:4000", "https://atacante.example"],
    [SITE, "javascript:alert(1)"],
    [SITE, "nao-e-url"],
  ])("com login em %s, recusa %s", (login, comunidade) => {
    expect(tokenDestinationProblem(comunidade, login)).not.toBeNull();
  });
});

describe("limite do corpo das respostas (A4)", () => {
  let fake: FakeSalesforce;

  beforeEach(async () => {
    fake = await startFakeSalesforce();
  });

  afterEach(async () => {
    await fake.close();
  });

  const enviar = () => postForm(`${fake.url}/limite`, new URLSearchParams(), { step: "token", timeoutMs: 2000 });

  it("aceita corpo com exatamente 1 MB", async () => {
    expect(MAX_RESPONSE_BYTES).toBe(1024 * 1024);
    fake.overrides.set("/limite", (res) => res.end("a".repeat(MAX_RESPONSE_BYTES)));

    const resposta = await enviar();

    expect(isFailure(resposta)).toBe(false);
    expect(resposta).toMatchObject({ status: 200 });
    expect((resposta as { body: string }).body).toHaveLength(MAX_RESPONSE_BYTES);
  });

  it("aborta ao ultrapassar, sem ler o restante da resposta", async () => {
    let bytesEscritos = 0;
    const conexaoFechada = new Promise<void>((resolve) => {
      // Corpo sem fim: só termina se o cliente abortar a conexão.
      fake.overrides.set("/limite", (res) => {
        res.writeHead(500);
        res.on("close", resolve);
        const bloco = Buffer.alloc(64 * 1024, "a");
        const escrever = () => {
          while (!res.destroyed) {
            bytesEscritos += bloco.length;
            if (!res.write(bloco)) {
              res.once("drain", escrever);
              return;
            }
          }
        };
        escrever();
      });
    });

    const resposta = await enviar();
    await conexaoFechada;

    expect(resposta).toMatchObject({ ok: false, step: "token", httpStatus: 500 });
    expect((resposta as { message: string }).message).toContain("1 MB");
    expect(resposta).not.toHaveProperty("rawBody");
    // Folga para os buffers do sistema: muito menos que um corpo sem limite.
    expect(bytesEscritos).toBeLessThan(64 * 1024 * 1024);
  });

  it("vale também para o GET com token", async () => {
    fake.overrides.set("/limite", (res) => res.end("a".repeat(MAX_RESPONSE_BYTES + 1)));

    const resposta = await getWithBearer(`${fake.url}/limite`, "SENTINELA-TOKEN", { step: "userinfo", timeoutMs: 2000 });

    expect(resposta).toMatchObject({ ok: false, step: "userinfo", httpStatus: 200 });
  });

  it("conta bytes, não caracteres", async () => {
    fake.overrides.set("/limite", (res) => res.end("ç".repeat(MAX_RESPONSE_BYTES / 2 + 1)));

    expect(isFailure(await enviar())).toBe(true);
  });
});
