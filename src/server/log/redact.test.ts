import { describe, expect, it } from "vitest";
import { maskOutput, redact, redactRawBody, secretsInJson } from "./redact";

describe("redact", () => {
  it("mascara segredo conhecido em todas as grafias e preserva o restante", () => {
    const secret = 'SENTINELA "S&H 1';
    const text = [
      `puro ${secret}`,
      `url ${encodeURIComponent(secret)}`,
      `form ${new URLSearchParams({ v: secret }).toString().slice(2)}`,
      `json ${JSON.stringify(secret)}`,
    ].join(" | ");

    expect(redact(text, [secret])).toBe('puro *** | url *** | form *** | json "***"');
  });

  it("mascara primeiro o segredo mais longo, sem deixar sobra", () => {
    expect(redact("x SENHATOKEN y", ["SENHA", "SENHATOKEN"])).toBe("x *** y");
  });

  it("mascara campos sensíveis pelo nome, em JSON e em formulário", () => {
    expect(redact('{"access_token":"abc\\"def","error":"e","code":"aPrx9Zq2mK"}')).toBe(
      '{"access_token":"***","error":"e","code":"***"}',
    );
    expect(redact("https://cb/?code=abc&state=s&password=p")).toBe("https://cb/?code=***&state=s&password=***");
    expect(redact("Authorization: Bearer abc")).toBe("Authorization: Bearer ***");
  });

  it("não altera texto comum que apenas lembra um campo sensível", () => {
    const text = "status code=400. Basic authentication failure. Bearer token invalid";
    expect(redact(text)).toBe(text);
  });
});

describe("redact em texto livre (D2)", () => {
  it.each([
    ["falha ao trocar code=SENTINELA-CODIGO-1 no servidor", "falha ao trocar code=*** no servidor"],
    ["erro: code=abc123 tente novamente", "erro: code=*** tente novamente"],
    ["(code=SENTINELA-CODIGO-1)", "(code=***)"],
    ["Code=aPrxZ%3D%3D recebido", "Code=*** recebido"],
    ["sid=00D000000000001 expirada", "sid=*** expirada"],
  ])("mascara %s", (texto, esperado) => {
    expect(redact(`x ${texto}`)).toBe(`x ${esperado}`);
  });

  it.each([
    "status code=400.",
    "HTTP status code=404, tente novamente",
    "falha com error code=invalid_grant ao autenticar",
    "falha com code=INVALID_SESSION_ID (sessão)",
    "O code foi recusado; informe o code novamente",
    "errorCode=abc123 fica como está",
    "code= vazio",
  ])("preserva o texto normal: %s", (texto) => {
    expect(redact(texto)).toBe(texto);
  });
});

describe("redact pelo nome, em qualquer posição (T16)", () => {
  it.each([
    ["code=VALOR", "code=***"],
    ["[code=VALOR]", "[code=***]"],
    ["<code=VALOR>", "<code=***>"],
    ["<p>code=VALOR fim</p>", "<p>code=*** fim</p>"],
    ['"code=VALOR"', '"code=***"'],
    ["'code=VALOR'", "'code=***'"],
    ["falhou+code%3DVALOR", "falhou+code%3D***"],
    ["falhou%20code%253DVALOR", "falhou%20code%253D***"],
    ["code: aPrx9Zq.", "code: ***."],
    ["code:aPrx9Zq", "code:***"],
    ["code = VALOR", "code = ***"],
    ['code="VALOR COM ESPACO" fim', 'code="***" fim'],
    ["code=&quot;VALOR&quot;", "code=&quot;***&quot;"],
    ["<code>VALOR</code>", "<code>***</code>"],
    ['{"error_description":"code=VALOR recusado"}', '{"error_description":"code=*** recusado"}'],
    ['{"error_description":"a\\ncode=VALOR\\nb"}', '{"error_description":"a\\ncode=***\\nb"}'],
    ['{"msg":"{\\"code\\":\\"aPrx9Zq\\"}"}', '{"msg":"{\\"code\\":\\"***\\"}"}'],
    ["a code\\u003dVALOR", "a code\\u003d***"],
    ["%22code%22%3A%22aPrx9Zq%22", "%22code%22%3A%22***%22"],
    ["<token>VALOR</token>", "<token>***</token>"],
  ])("mascara %s", (texto, esperado) => {
    expect(redact(texto)).toBe(esperado);
  });

  it.each(["token", "access_token", "refresh_token", "password"])("mascara %s em todas as formas", (nome) => {
    for (const [texto, esperado] of [
      [`${nome}=VALOR`, `${nome}=***`],
      [`[${nome}=VALOR]`, `[${nome}=***]`],
      [`<${nome}=VALOR>`, `<${nome}=***>`],
      [`'${nome}=VALOR'`, `'${nome}=***'`],
      [`x+${nome}%3DVALOR`, `x+${nome}%3D***`],
      [`${nome}: aPrx9Zq`, `${nome}: ***`],
      [`{"${nome}":"VALOR"}`, `{"${nome}":"***"}`],
      [`{"m":"${nome}=VALOR"}`, `{"m":"${nome}=***"}`],
      [`${nome}=400`, `${nome}=***`],
    ] as const) {
      expect(redact(texto)).toBe(esperado);
    }
  });

  it.each([
    "status code=400",
    "status code: 400",
    "code=invalid_grant",
    "code: invalid_grant.",
    '{"code":"invalid_grant"}',
    "code%3Dinvalid_grant",
    "[code=400]",
    "errorCode: abc123",
    '{"token_type":"Bearer"}',
    "Bearer token invalid",
    "code_challenge=abc",
  ])("preserva %s", (texto) => {
    expect(redact(texto)).toBe(texto);
  });

  it("é idempotente, pois a saída pode passar pela máscara mais de uma vez", () => {
    const uma = redact('code=VALOR {"password":"VALOR"} code%3DVALOR "code: VALOR"');
    expect(redact(uma)).toBe(uma);
  });

  it("mantém tempo linear em corpo de 1 MB", () => {
    const inicio = Date.now();
    redact(`code${"=code".repeat(200_000)} ${"code:".repeat(50_000)} ${"%25".repeat(100_000)}`);
    expect(Date.now() - inicio).toBeLessThan(2000);
  });
});

describe("secretsInJson (T16)", () => {
  it("colhe valores de campos sensíveis em qualquer nível, sem os valores comuns de code", () => {
    expect(
      secretsInJson({
        access_token: "a",
        nivel: [{ refresh_token: "b" }],
        code: "invalid_grant",
        outro: { code: "c" },
        token_type: "Bearer",
      }).sort(),
    ).toEqual(["a", "b", "c"]);
  });
});

describe("maskOutput (T16)", () => {
  it("usa a mesma máscara em todos os campos de saída e não cria campos", () => {
    expect(
      maskOutput(
        { ok: false, error: "SEGREDO1", errorDescription: "SEGREDO1", rawBody: "SEGREDO1", message: "SEGREDO1", instanceUrl: "https://h/SEGREDO1", step: "SEGREDO1" },
        ["SEGREDO1"],
      ),
    ).toEqual({
      ok: false,
      error: "***",
      errorDescription: "***",
      rawBody: "***",
      message: "***",
      instanceUrl: "https://h/***",
      step: "SEGREDO1",
    });
    expect(maskOutput({ ok: true, error: undefined }, ["S1"])).toEqual({ ok: true });
  });

  it("trunca rawBody depois de mascarar", () => {
    const { rawBody } = maskOutput({ rawBody: `${"a".repeat(1990)}SEGREDO-LONGO-123${"b".repeat(50)}` }, ["SEGREDO-LONGO-123"]);
    expect(rawBody).not.toContain("SEGREDO");
    expect(rawBody).toContain("[truncado]");
  });
});

describe("redactRawBody", () => {
  it("mascara antes de truncar, sem expor parte de um segredo no corte", () => {
    const secret = "SENTINELA-SENHA-123";
    const result = redactRawBody(`${"a".repeat(1990)}${secret}${"b".repeat(50)}`, [secret]);
    expect(result).not.toContain("SENTINELA");
    expect(result).toContain("[truncado]");
  });
});

describe("JSON de erro é mascarado pela estrutura (T17, item 1)", () => {
  it.each([
    [
      '{"error":"invalid_token","error_description":"the token is invalid","token":"invalid"}',
      '{"error":"invalid_token","error_description":"the token is invalid","token":"***"}',
    ],
    [
      '{"error":"invalid_grant","error_description":"authentication failure","token":"e"}',
      '{"error":"invalid_grant","error_description":"authentication failure","token":"***"}',
    ],
    ['{"token":12345}', '{"token":"***"}'],
  ])("mascara só o campo: %s", (texto, esperado) => {
    expect(redact(texto)).toBe(esperado);
  });

  it.each([
    '{"code":"E1001","message":"erro E1001"}',
    '{"code":"unauthorized"}',
    '{"token":null}',
    '{"token":false}',
    '{"password":true,"access_token":null}',
    '[{"errorCode":"INVALID_SESSION_ID","message":"Session expired or invalid"}]',
    '{ "code" : "E1001",\n  "b": 1.50 }',
    'erro: {"token":null,"code":"E1001"} fim',
  ])("preserva literalmente: %s", (texto) => {
    expect(redact(texto)).toBe(texto);
  });

  it("não troca formatação nem ordem do corpo original", () => {
    expect(redact('{ "b" : 1.50,\n "a":"x", "token" : "y" }')).toBe('{ "b" : 1.50,\n "a":"x", "token" : "***" }');
  });

  it("reconhece o nome escrito com escape e chave repetida", () => {
    expect(redact('{"tok\\u0065n":"y"}')).toBe('{"tok\\u0065n":"***"}');
    expect(redact('{"token":"a","token":"b"}')).toBe('{"token":"***","token":"***"}');
  });

  it("segue mascarando texto livre dentro do JSON, e JSON dentro de texto", () => {
    expect(redact('{"m":"code=VALOR recusado","n":"{\\"token\\":\\"x\\",\\"code\\":\\"E1\\"}"}')).toBe(
      '{"m":"code=*** recusado","n":"{\\"token\\":\\"***\\",\\"code\\":\\"E1\\"}"}',
    );
  });

  it("segredo conhecido vale também em code mantido, chave e número", () => {
    expect(redact('{"code":"E1001"}', ["E1001"])).toBe('{"code":"***"}');
    expect(redact('{"SEGREDO-LONGO":1}', ["SEGREDO-LONGO"])).toBe('{"***":1}');
    expect(redact('{"a":987654}', ["987654"])).toBe('{"a":***}');
  });

  it("é idempotente em JSON e em JSON truncado", () => {
    const uma = redact('{"token":"y","code":"aPrx9Zq2mK","x":"code=V"}');
    expect(redact(uma)).toBe(uma);
    const cortado = redact('{"token":"y","code":"E1001","m":"');
    expect(redact(cortado)).toBe(cortado);
  });
});

describe("code e errorCode em JSON (T17, item 2)", () => {
  it.each(["E1001", "400", "unauthorized", "INVALID_SESSION_ID", "invalid_grant", "InvalidGrant", "ERR-42", "api.disabled"])(
    "mantém o código de erro %s",
    (valor) => {
      for (const nome of ["code", "errorCode"]) {
        const texto = JSON.stringify({ [nome]: valor });
        expect(redact(texto)).toBe(texto);
      }
    },
  );

  it.each(["aPrx9Zq2mK", "a1b2c3d4", "aPrxZ==", "x".repeat(33), "123456", "E1001 com espaco"])(
    "mascara o que parece segredo: %s",
    (valor) => {
      for (const nome of ["code", "errorCode"]) {
        expect(redact(JSON.stringify({ [nome]: valor }))).toBe(JSON.stringify({ [nome]: "***" }));
      }
    },
  );

  it("mantém o limite de 32 caracteres", () => {
    const texto = JSON.stringify({ code: "X".repeat(32) });
    expect(redact(texto)).toBe(texto);
  });
});

describe("forma com dois-pontos (T17, item 3)", () => {
  it.each([
    "authorization code: expired",
    "token: expired",
    "password: incorrect",
    "access token: expired or revoked",
    "code: VALOR.",
    'token: "expired"',
  ])("preserva %s", (texto) => {
    expect(redact(texto)).toBe(texto);
  });

  it.each([
    ["token: abcdefghijklmnop", "token: ***"],
    ["password: abc123", "password: ***"],
    ["code: aPrx9, tente", "code: ***, tente"],
    ['token: "abc123"', 'token: "***"'],
    ["access_token:0123456789abcdef", "access_token:***"],
  ])("mascara %s", (texto, esperado) => {
    expect(redact(texto)).toBe(esperado);
  });

  it.each([
    ["token=expired", "token=***"],
    ["password=incorrect", "password=***"],
    ["code = VALOR", "code = ***"],
    ["token=null", "token=***"],
  ])("a forma com = continua mascarada: %s", (texto, esperado) => {
    expect(redact(texto)).toBe(esperado);
  });

  it("nome entre aspas em texto que não é JSON completo segue a regra de JSON", () => {
    expect(redact('{"token":"expired","a":"')).toBe('{"token":"***","a":"');
    expect(redact("%22code%22%3A%22aPrx9Zq2mK%22")).toBe("%22code%22%3A%22***%22");
  });
});

describe("segredo conhecido curto (T17, item 4)", () => {
  it("só substitui a palavra inteira abaixo de 6 caracteres", () => {
    expect(redact("https://h/p p", ["p"])).toBe("https://h/*** ***");
    expect(redact("authentication failure", ["e"])).toBe("authentication failure");
    expect(redact("a_p p_a pp", ["p"])).toBe("a_p p_a pp");
    expect(redact("ação é", ["a"])).toBe("ação é");
  });

  it("reconhece a palavra depois de escape de JSON e de URL", () => {
    expect(redact("a\\nabc\\n%20abc%20", ["abc"])).toBe("a\\n***\\n%20***%20");
  });

  it("a partir de 6 caracteres segue substituindo em qualquer posição", () => {
    expect(redact("xSEGREDy", ["SEGRED"])).toBe("x***y");
  });

  it("não corrompe mensagem da ferramenta com segredo curto, e mascara o erro do servidor", () => {
    const mensagem = "O servidor não devolveu a resposta";
    expect(maskOutput({ message: mensagem, error: "a b" }, ["O", "a"])).toEqual({ message: mensagem, error: "*** b" });
  });

  it("mensagem segue mascarando segredo longo", () => {
    expect(maskOutput({ message: "falhou SEGREDO-LONGO" }, ["SEGREDO-LONGO"])).toEqual({ message: "falhou ***" });
  });
});

describe("secretsInJson em objetos e listas (T17, item 5, V3)", () => {
  it.each([
    [{ access_token: { value: "X" } }, ["X"]],
    [{ access_token: ["a", "X"] }, ["a", "X"]],
    [{ refresh_token: [{ v: { w: "X" } }, 7] }, ["X", "7"]],
    [{ a: { accessToken: "X" } }, ["X"]],
    [{ access_token: { a: null, b: true } }, []],
  ])("%j", (json, esperado) => {
    expect(secretsInJson(json)).toEqual(esperado);
  });

  it("redact mascara os valores nesses mesmos caminhos", () => {
    expect(redact('{"access_token":{"value":"X","n":null},"token":["a",1]}')).toBe(
      '{"access_token":{"value":"***","n":null},"token":["***","***"]}',
    );
  });
});

describe("grafias de escape de segredo conhecido (T17, item 6, V7)", () => {
  const segredo = 'SEGREDO/"çã&<>\'';
  it.each([
    ["JSON com \\/", 'SEGREDO\\/\\"çã&<>\''],
    ["JSON com \\u minúsculo", 'SEGREDO/\\"\\u00e7\\u00e3&<>\''],
    ["JSON com \\u maiúsculo", 'SEGREDO/\\"\\u00E7\\u00E3&<>\''],
    ["JSON com \\/ e \\u", 'SEGREDO\\/\\"\\u00e7\\u00e3&<>\''],
    ["HTML com &quot; e &#39;", "SEGREDO/&quot;çã&amp;&lt;&gt;&#39;"],
    ["HTML com &#34; e &#39;", "SEGREDO/&#34;çã&amp;&lt;&gt;&#39;"],
    ["HTML com &quot; e apóstrofo", "SEGREDO/&quot;çã&amp;&lt;&gt;'"],
    ["HTML com &#34; e apóstrofo", "SEGREDO/&#34;çã&amp;&lt;&gt;'"],
  ])("%s", (_nome, grafia) => {
    expect(redact(`a ${grafia} b`, [segredo])).toBe("a *** b");
  });

  it("vale dentro de um corpo JSON", () => {
    expect(redact(JSON.stringify({ m: "x\\u00e7" }).replace("x\\\\u00e7", "x\\u00e7"), ["xç"])).toBe('{"m":"***"}');
  });
});

describe("nomes alternativos (T17, item 7, V9)", () => {
  it.each(["accessToken", "refreshToken", "clientSecret", "codeVerifier"])("mascara %s com = e em JSON", (nome) => {
    expect(redact(`${nome}=VALOR`)).toBe(`${nome}=***`);
    expect(redact(JSON.stringify({ [nome]: "VALOR" }))).toBe(JSON.stringify({ [nome]: "***" }));
    expect(secretsInJson({ [nome]: "VALOR" })).toEqual(["VALOR"]);
  });

  it.each(["authToken=VALOR", "sessionId=VALOR", "apiKey=VALOR", '{"bearerToken":"VALOR"}'])(
    "fora do escopo, não é tratado: %s",
    (texto) => {
      expect(redact(texto)).toBe(texto);
    },
  );
});

describe("robustez da máscara (T17)", () => {
  it.each(["a-b", "a/b", "(a]", "a.b", "$&", "\\d"])("segredo curto com caractere especial: %s", (segredo) => {
    expect(redact(`x ${segredo} y`, [segredo])).toBe("x *** y");
  });

  it("mantém tempo linear em JSON de 1 MB, com segredos curtos", () => {
    const corpo = JSON.stringify({ lista: Array.from({ length: 60_000 }, (_, i) => ({ token: "a", n: i })) });
    const inicio = Date.now();
    expect(redact(corpo, ["p", "abc"])).toContain('"token":"***"');
    expect(Date.now() - inicio).toBeLessThan(2000);
  });
});
