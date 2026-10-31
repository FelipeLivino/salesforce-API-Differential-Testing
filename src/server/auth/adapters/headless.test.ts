import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_CLIENT_ID, type FakeSalesforce, startFakeSalesforce } from "../../../../tests/fake-salesforce/server";
import type { LoginFailure, LoginInput, LoginSuccess } from "../types";
import { createHeadlessAdapter } from "./headless";

const PASSWORD = "SENTINELA-SENHA-123";
const CLIENT_SECRET = "SENTINELA-SECRET-123";
const AUTHORIZE = "/services/oauth2/authorize";
const TOKEN = "/services/oauth2/token";

const adapter = createHeadlessAdapter({ timeoutMs: 2000 });

describe("adaptador Headless", () => {
  let fake: FakeSalesforce;
  let input: LoginInput;

  beforeEach(async () => {
    fake = await startFakeSalesforce({ users: [{ username: "comunidade@teste.invalid", password: PASSWORD }] });
    input = {
      loginUrl: fake.url,
      clientId: FAKE_CLIENT_ID,
      redirectUri: `${fake.url}/callback`,
      username: "comunidade@teste.invalid",
      password: PASSWORD,
    };
  });

  afterEach(async () => {
    await fake.close();
  });

  function redirectWith(params: Record<string, string>, status = 302): void {
    fake.overrides.set(AUTHORIZE, (res, request) => {
      const location = new URL(`${fake.url}/callback`);
      const state = request.form.get("state");
      if (state !== null && !("state" in params)) {
        location.searchParams.set("state", state);
      }
      for (const [key, value] of Object.entries(params)) {
        location.searchParams.set(key, value);
      }
      res.writeHead(status, { Location: location.toString() });
      res.end();
    });
  }

  it("autentica pelo fluxo completo, usando apenas authorize e token", async () => {
    const result = (await adapter.login(input)) as LoginSuccess;

    expect(result.ok).toBe(true);
    expect(result.accessToken).toMatch(/^SENTINELA-TOKEN-/);
    expect(fake.requests.map((request) => request.path)).toEqual([AUTHORIZE, TOKEN]);
  });

  it("usa sfdc_community_url como URL base, não instance_url", async () => {
    const result = (await adapter.login(input)) as LoginSuccess;

    expect(result.instanceUrl).toBe(fake.url);
  });

  it("envia o authorize no formato documentado, com credenciais só no corpo", async () => {
    await adapter.login(input);

    const request = fake.calls(AUTHORIZE)[0]!;
    expect(request.method).toBe("POST");
    expect(request.query).toBe("");
    expect(request.headers["auth-request-type"]).toBe("Named-User");
    expect(request.headers.authorization).toBeUndefined();
    expect(request.form.get("response_type")).toBe("code_credentials");
    expect(request.form.get("login_hint")).toBe(input.username);
    expect(request.form.get("password")).toBe(PASSWORD);
    expect(request.form.get("redirect_uri")).toBe(input.redirectUri);
  });

  it("não acrescenta o security token à senha", async () => {
    const result = await adapter.login({ ...input, securityToken: "SENTINELA-SECTOKEN-123" });

    expect(result.ok).toBe(true);
    expect(fake.calls(AUTHORIZE)[0]!.form.get("password")).toBe(PASSWORD);
  });

  it("não segue o redirect até o callback", async () => {
    await adapter.login(input);

    expect(fake.calls("/callback")).toHaveLength(0);
  });

  it("envia o verificador que corresponde ao desafio, sem credenciais na troca do code", async () => {
    await adapter.login(input);

    const challenge = fake.calls(AUTHORIZE)[0]!.form.get("code_challenge");
    const tokenForm = fake.calls(TOKEN)[0]!.form;
    const verifier = tokenForm.get("code_verifier")!;
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(challenge);
    expect(tokenForm.get("grant_type")).toBe("authorization_code");
    expect(tokenForm.has("password")).toBe(false);
  });

  it("gera verificador e state novos a cada tentativa", async () => {
    await adapter.login(input);
    await adapter.login(input);

    const [first, second] = fake.calls(TOKEN);
    const [firstAuth, secondAuth] = fake.calls(AUTHORIZE);
    expect(first!.form.get("code_verifier")).not.toBe(second!.form.get("code_verifier"));
    expect(firstAuth!.form.get("state")).not.toBe(secondAuth!.form.get("state"));
  });

  it("envia client_secret na troca do code apenas quando informado", async () => {
    await adapter.login(input);
    await adapter.login({ ...input, clientSecret: CLIENT_SECRET });

    const [without, withSecret] = fake.calls(TOKEN);
    expect(without!.form.has("client_secret")).toBe(false);
    expect(withSecret!.form.get("client_secret")).toBe(CLIENT_SECRET);
  });

  it("faz a troca do code no host e caminho do sfdc_community_url", async () => {
    fake.communityPath = "/portal/";
    const result = (await adapter.login(input)) as LoginSuccess;

    expect(fake.calls(TOKEN)[0]!.path).toBe(`/portal${TOKEN}`);
    expect(result.instanceUrl).toBe(`${fake.url}/portal/`);
  });

  it("não mostra sucesso quando o servidor rejeita o verificador PKCE", async () => {
    // HIPÓTESE: a causa invalid_grant é documentada, mas status e corpo não são confirmados.
    fake.corruptNextChallenge = true;

    const result = (await adapter.login(input)) as LoginFailure;

    expect(result).toMatchObject({ ok: false, kind: "salesforce", step: "token", error: "invalid_grant" });
    expect(JSON.stringify(result)).not.toContain("SENTINELA");
  });

  it("preserva erro devolvido em JSON no authorize", async () => {
    // HIPÓTESE: o formato do erro no authorize é não confirmado (fluxos-login.md, 2.6).
    fake.overrides.set(AUTHORIZE, (res) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "erro_ARBITRARIO", error_description: "Descrição Arbitrária" }));
    });

    const result = (await adapter.login(input)) as LoginFailure;

    expect(result).toMatchObject({
      kind: "salesforce",
      step: "authorize",
      httpStatus: 400,
      error: "erro_ARBITRARIO",
      errorDescription: "Descrição Arbitrária",
    });
    expect(result.message).toBeUndefined();
    expect(fake.calls(TOKEN)).toHaveLength(0);
  });

  it("preserva erro devolvido no redirect do authorize", async () => {
    // HIPÓTESE: erro no Location segue o padrão OAuth; não está confirmado para este fluxo.
    redirectWith({ error: "erro_NO_REDIRECT", error_description: "Descrição + com espaço" });

    const result = (await adapter.login(input)) as LoginFailure;

    expect(result).toMatchObject({
      step: "authorize",
      httpStatus: 302,
      error: "erro_NO_REDIRECT",
      errorDescription: "Descrição + com espaço",
    });
    expect(fake.calls(TOKEN)).toHaveLength(0);
  });

  it("recusa credenciais inválidas", async () => {
    // HIPÓTESE: invalid_grant é documentado, mas status e corpo não são confirmados.
    const result = await adapter.login({ ...input, password: "SENTINELA-SENHA-ERRADA" });

    expect(result).toMatchObject({ ok: false, step: "authorize", error: "invalid_grant" });
    expect(JSON.stringify(result)).not.toContain("SENTINELA");
  });

  it("mascara senha, code e verificador devolvidos no erro da troca do code", async () => {
    // HIPÓTESE: nada indica que o Salesforce repita segredos; o caso cobre o critério FT.3.
    fake.overrides.set(TOKEN, (res, request) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "erro_x",
          error_description: `a ${PASSWORD} b ${request.form.get("code")} c ${request.form.get("code_verifier")} d`,
        }),
      );
    });

    const result = (await adapter.login(input)) as LoginFailure;

    expect(result.errorDescription).toBe("a *** b *** c *** d");
    expect(result.rawBody).not.toContain("SENTINELA");
    expect(JSON.stringify(result)).not.toContain(fake.calls(TOKEN)[0]!.form.get("code_verifier")!);
  });

  it("recusa state divergente, sem trocar o code", async () => {
    redirectWith({ state: "outro-state", code: "SENTINELA-CODIGO-X", sfdc_community_url: "https://x.invalid" });

    const result = await adapter.login(input);

    expect(result).toMatchObject({ ok: false, step: "authorize" });
    expect(JSON.stringify(result)).not.toContain("SENTINELA");
    expect(fake.calls(TOKEN)).toHaveLength(0);
  });

  it("recusa redirect sem code ou sem sfdc_community_url", async () => {
    redirectWith({ code: "SENTINELA-CODIGO-X" });

    const result = await adapter.login(input);

    expect(result).toMatchObject({ ok: false, step: "authorize" });
    expect(JSON.stringify(result)).not.toContain("SENTINELA");
    expect(fake.calls(TOKEN)).toHaveLength(0);
  });

  it("recusa sfdc_community_url inseguro, sem enviar code, verificador ou secret", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    redirectWith({ code: "SENTINELA-CODIGO-X", sfdc_community_url: "http://host-inseguro.invalid" });

    const result = await adapter.login({ ...input, clientSecret: CLIENT_SECRET });

    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("host-inseguro"))).toBe(false);
    expect(result).toMatchObject({ ok: false, step: "authorize" });
    expect(JSON.stringify(result)).not.toContain("SENTINELA");
  });

  it("redirect de erro não promove o code: só o próprio parâmetro é mascarado (S12, substitui D2)", async () => {
    redirectWith({
      code: "VALOR-DO-CAMPO",
      error: "invalid_grant",
      error_description: "codigo VALOR-DO-CAMPO recusado",
    });

    const result = (await adapter.login(input)) as LoginFailure;

    expect(result.error).toBe("invalid_grant");
    expect(result.errorDescription).toBe("codigo VALOR-DO-CAMPO recusado");
    expect(result.rawBody).toContain("code=***");
  });

  it("mascara code e verificador ecoados na troca do code (D2)", async () => {
    fake.overrides.set(TOKEN, (res, request) => {
      const eco = `${request.form.get("code")} / ${request.form.get("code_verifier")}`;
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant", error_description: `recusado: ${eco}`, eco }));
    });

    const result = (await adapter.login(input)) as LoginFailure;

    const verifier = fake.calls(TOKEN)[0]!.form.get("code_verifier")!;
    expect(result.errorDescription).toBe("recusado: *** / ***");
    expect(JSON.stringify(result)).not.toContain(verifier);
    expect(JSON.stringify(result)).not.toContain("SENTINELA-CODIGO");
  });

  it("devolve code e verificador junto do token, só para o mascaramento seguinte (D2)", async () => {
    const result = (await adapter.login(input)) as LoginSuccess;

    const form = fake.calls(TOKEN)[0]!.form;
    expect(result.maskValues).toEqual(expect.arrayContaining([form.get("code"), form.get("code_verifier")]));
  });

  it("recusa no authorize host fora da lista, sem enviar code, verificador ou secret (A2)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    redirectWith({ code: "SENTINELA-CODIGO-X", sfdc_community_url: "https://atacante.example" });

    const result = (await adapter.login({ ...input, clientSecret: CLIENT_SECRET })) as LoginFailure;

    expect(result).toMatchObject({ ok: false, kind: "salesforce", step: "authorize" });
    expect(result.message).toContain("sfdc_community_url");
    expect(result.message).toContain(".salesforce.com");
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("atacante"))).toBe(false);
    expect(fake.calls(TOKEN)).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain("SENTINELA");
  });

  it("recusa na resposta de token host fora da lista, e o token não fica disponível (A2)", async () => {
    fake.extraTokenFields = { sfdc_community_url: "https://atacante.example" };

    const result = (await adapter.login(input)) as LoginFailure;

    expect(result).toMatchObject({ ok: false, kind: "salesforce", step: "token" });
    expect(result.message).toContain("sfdc_community_url");
    expect(JSON.stringify(result)).not.toContain("SENTINELA-TOKEN");
  });

  it("resposta 200 no authorize, sem redirect, não é tratada como sucesso", async () => {
    fake.overrides.set(AUTHORIZE, (res) => {
      res.writeHead(200);
      res.end("<html>pagina de login</html>");
    });

    const result = (await adapter.login(input)) as LoginFailure;

    expect(result).toMatchObject({ ok: false, kind: "salesforce", step: "authorize", httpStatus: 200 });
    expect(result.message).toBeTruthy();
  });

  it("resposta malformada na troca do code gera falha clara", async () => {
    fake.overrides.set(TOKEN, (res) => {
      res.writeHead(200);
      res.end("{quebrado");
    });

    const result = (await adapter.login(input)) as LoginFailure;

    expect(result).toMatchObject({ ok: false, kind: "salesforce", step: "token" });
    expect(result.message).toBeTruthy();
  });

  it("servidor desligado gera erro de conexão", async () => {
    await fake.close();
    const result = await adapter.login(input);
    fake = await startFakeSalesforce();

    expect(result).toMatchObject({ ok: false, kind: "rede", step: "authorize" });
    expect(JSON.stringify(result)).not.toContain("SENTINELA");
  });

  it("servidor sem resposta na troca do code gera erro de rede", async () => {
    fake.overrides.set(TOKEN, () => undefined);

    const result = await createHeadlessAdapter({ timeoutMs: 50 }).login(input);

    expect(result).toMatchObject({ ok: false, kind: "rede", step: "token" });
  });

  it("exige redirect URI, sem nenhuma chamada", async () => {
    const { redirectUri: _omitted, ...withoutRedirect } = input;

    const result = (await adapter.login(withoutRedirect)) as LoginFailure;

    expect(result.kind).toBe("configuracao");
    expect(result.message).toContain("redirect URI");
    expect(fake.requests).toHaveLength(0);
  });

  it("recusa URL insegura, sem nenhuma chamada", async () => {
    const result = await adapter.login({ ...input, loginUrl: "http://host-inseguro.invalid" });

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
