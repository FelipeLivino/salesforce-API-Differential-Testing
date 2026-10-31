import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_CLIENT_ID, type FakeSalesforce, startFakeSalesforce } from "../../../../tests/fake-salesforce/server";
import type { LoginFailure, LoginInput, LoginSuccess } from "../types";
import { createUsernamePasswordAdapter } from "./username-password";

const PASSWORD = "SENTINELA-SENHA-123";
const SECURITY_TOKEN = "SENTINELA-SECTOKEN-123";
const CLIENT_SECRET = "SENTINELA-SECRET-123";

const adapter = createUsernamePasswordAdapter({ timeoutMs: 2000 });

describe("adaptador Username-Password", () => {
  let fake: FakeSalesforce;
  let input: LoginInput;

  beforeEach(async () => {
    fake = await startFakeSalesforce({
      users: [
        { username: "com-token@teste.invalid", password: PASSWORD, securityToken: SECURITY_TOKEN },
        { username: "sem-token@teste.invalid", password: PASSWORD },
        { username: "especial@teste.invalid", password: "a&b=c +d%é" },
      ],
    });
    input = {
      loginUrl: fake.url,
      clientId: FAKE_CLIENT_ID,
      username: "sem-token@teste.invalid",
      password: PASSWORD,
    };
  });

  afterEach(async () => {
    await fake.close();
  });

  it("autentica sem security token e devolve instance_url exatamente como veio", async () => {
    const result = (await adapter.login(input)) as LoginSuccess;

    expect(result.ok).toBe(true);
    expect(result.accessToken).toBe("SENTINELA-TOKEN-1");
    expect(result.instanceUrl).toBe(`${fake.url}/`);
    expect(result.issuedAt.getTime()).toBe(1700000000000);
  });

  it("concatena o security token ao final da senha, sem parâmetro próprio", async () => {
    const result = await adapter.login({
      ...input,
      username: "com-token@teste.invalid",
      securityToken: SECURITY_TOKEN,
    });

    expect(result.ok).toBe(true);
    const { form } = fake.calls("/services/oauth2/token")[0]!;
    expect(form.get("password")).toBe(`${PASSWORD}${SECURITY_TOKEN}`);
    expect(form.has("security_token")).toBe(false);
  });

  it("envia só no corpo, sem scope, sem query e com caracteres especiais codificados", async () => {
    const result = await adapter.login({ ...input, username: "especial@teste.invalid", password: "a&b=c +d%é" });

    expect(result.ok).toBe(true);
    const request = fake.calls("/services/oauth2/token")[0]!;
    expect(request.query).toBe("");
    expect(request.form.get("grant_type")).toBe("password");
    expect(request.form.has("scope")).toBe(false);
    expect(request.headers["content-type"]).toBe("application/x-www-form-urlencoded");
  });

  it("envia client_secret apenas quando informado", async () => {
    await adapter.login(input);
    await adapter.login({ ...input, clientSecret: CLIENT_SECRET });

    const [without, withSecret] = fake.calls("/services/oauth2/token");
    expect(without!.form.has("client_secret")).toBe(false);
    expect(withSecret!.form.get("client_secret")).toBe(CLIENT_SECRET);
  });

  it("sem expires_in, não estima validade", async () => {
    const result = (await adapter.login(input)) as LoginSuccess;

    expect(result.expiresAt).toBeNull();
    expect(result.expiresAtSource).toBe("nao-informado");
  });

  it("com expires_in válido, usa o valor informado", async () => {
    fake.extraTokenFields = { expires_in: 3600 };
    const before = Date.now();
    const result = (await adapter.login(input)) as LoginSuccess;

    expect(result.expiresAtSource).toBe("salesforce");
    expect(result.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 3_600_000);
  });

  it.each([0, -1, "abc", null])("trata expires_in não confiável (%s) como não informado", async (value) => {
    fake.extraTokenFields = { expires_in: value };
    const result = (await adapter.login(input)) as LoginSuccess;

    expect(result.expiresAt).toBeNull();
    expect(result.expiresAtSource).toBe("nao-informado");
  });

  it("preserva error e error_description arbitrários, sem mensagem própria", async () => {
    // HIPÓTESE: status e corpo exatos do erro são não confirmados (fluxos-login.md, seção 7, item 1).
    fake.overrides.set("/services/oauth2/token", (res) => {
      res.writeHead(418, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "erro_ARBITRARIO", error_description: "Descrição  Arbitrária: ç!" }));
    });

    const result = (await adapter.login(input)) as LoginFailure;

    expect(result).toMatchObject({
      ok: false,
      kind: "salesforce",
      step: "token",
      httpStatus: 418,
      error: "erro_ARBITRARIO",
      errorDescription: "Descrição  Arbitrária: ç!",
    });
    expect(result.message).toBeUndefined();
  });

  it("devolve invalid_grant para senha sem o security token exigido", async () => {
    // HIPÓTESE: a variante "authentication failure" vem de fonte indireta (fluxos-login.md, 3.4).
    const result = (await adapter.login({ ...input, username: "com-token@teste.invalid" })) as LoginFailure;

    expect(result).toMatchObject({ error: "invalid_grant", errorDescription: "authentication failure" });
  });

  it("mascara segredos devolvidos no erro e preserva o restante", async () => {
    // HIPÓTESE: nada indica que o Salesforce repita segredos; o caso cobre o critério FT.3.
    fake.overrides.set("/services/oauth2/token", (res) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "erro_x",
          error_description: `falhou com ${PASSWORD} e ${SECURITY_TOKEN} e ${CLIENT_SECRET} no fim`,
        }),
      );
    });

    const result = (await adapter.login({
      ...input,
      securityToken: SECURITY_TOKEN,
      clientSecret: CLIENT_SECRET,
    })) as LoginFailure;

    expect(result.errorDescription).toBe("falhou com *** e *** e *** no fim");
    expect(JSON.stringify(result)).not.toContain("SENTINELA");
  });

  it("não segue redirecionamento", async () => {
    let followed = false;
    fake.overrides.set("/outro-host", (res) => {
      followed = true;
      res.end();
    });
    fake.overrides.set("/services/oauth2/token", (res) => {
      res.writeHead(307, { Location: `${fake.url}/outro-host` });
      res.end();
    });

    const result = (await adapter.login(input)) as LoginFailure;

    expect(followed).toBe(false);
    expect(result).toMatchObject({ ok: false, kind: "salesforce", httpStatus: 307 });
  });

  it("resposta malformada gera falha clara, sem sucesso", async () => {
    fake.overrides.set("/services/oauth2/token", (res) => {
      res.writeHead(200);
      res.end("<html>nao e json</html>");
    });

    const result = (await adapter.login(input)) as LoginFailure;

    expect(result).toMatchObject({ ok: false, kind: "salesforce", httpStatus: 200 });
    expect(result.message).toBeTruthy();
    expect(result.rawBody).toContain("nao e json");
  });

  it("recusa resposta sem instance_url e não expõe o token recebido", async () => {
    fake.overrides.set("/services/oauth2/token", (res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ access_token: "SENTINELA-TOKEN-X" }));
    });

    const result = await adapter.login(input);

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("SENTINELA");
  });

  it("recusa instance_url sem https, para o token não ir a host inseguro", async () => {
    fake.extraTokenFields = { instance_url: "http://host-inseguro.invalid" };

    const result = await adapter.login(input);

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("SENTINELA");
  });

  it("servidor desligado gera erro de conexão, distinto de erro do Salesforce", async () => {
    await fake.close();
    const result = (await adapter.login(input)) as LoginFailure;
    fake = await startFakeSalesforce();

    expect(result).toMatchObject({ ok: false, kind: "rede", step: "token" });
    expect(result.error).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("SENTINELA");
  });

  it("servidor sem resposta gera erro de rede por tempo limite", async () => {
    fake.overrides.set("/services/oauth2/token", () => undefined);

    const result = await createUsernamePasswordAdapter({ timeoutMs: 50 }).login(input);

    expect(result).toMatchObject({ ok: false, kind: "rede" });
  });

  it("respeita o cancelamento externo", async () => {
    fake.overrides.set("/services/oauth2/token", () => undefined);
    const controller = new AbortController();

    const pending = adapter.login(input, controller.signal);
    controller.abort();

    expect(await pending).toMatchObject({ ok: false, kind: "rede" });
  });

  it.each([
    ["http fora de loopback", "http://host-inseguro.invalid"],
    ["credenciais na URL", "https://usuario:SENTINELA-SENHA-123@host.invalid"],
    ["query string", "https://host.invalid/?a=1"],
    ["texto que não é URL", "nao e url"],
  ])("recusa %s sem nenhuma chamada e sem repetir a URL", async (_name, loginUrl) => {
    const result = (await adapter.login({ ...input, loginUrl })) as LoginFailure;

    expect(result).toMatchObject({ ok: false, kind: "configuracao" });
    expect(JSON.stringify(result)).not.toContain("SENTINELA");
    expect(fake.requests).toHaveLength(0);
  });

  it("recusa campo obrigatório vazio sem nenhuma chamada", async () => {
    const result = await adapter.login({ ...input, password: "" });

    expect(result).toMatchObject({ ok: false, kind: "configuracao" });
    expect(fake.requests).toHaveLength(0);
  });

  it("não registra nada em log, no sucesso ou na falha", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );

    await adapter.login(input);
    await adapter.login({ ...input, password: "SENTINELA-SENHA-ERRADA" });

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
