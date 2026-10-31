import { randomBytes } from "node:crypto";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertEncryptionKeyConfigured,
  decryptSecret,
  encryptSecret,
  SecretsCryptoError,
  type SecretsCryptoErrorCode,
} from "./secrets";

const SENTINEL = "SENTINELA-SENHA-123";

const newKey = () => randomBytes(32).toString("base64");

/** Executa e devolve o erro, para inspecionar código e conteúdo. */
function captureError(fn: () => unknown): SecretsCryptoError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(SecretsCryptoError);
    return error as SecretsCryptoError;
  }
  throw new Error("era esperado um erro");
}

/** Texto completo que um log do erro mostraria: mensagem, pilha e propriedades. */
function everythingVisible(error: SecretsCryptoError): string {
  return [error.message, error.stack, inspect(error, { depth: 5 }), JSON.stringify(error)].join("\n");
}

function expectFailure(fn: () => unknown, code: SecretsCryptoErrorCode, forbidden: string[]): void {
  const error = captureError(fn);
  expect(error.code).toBe(code);
  expect(error.cause).toBeUndefined();
  const visible = everythingVisible(error);
  for (const value of forbidden) {
    expect(visible).not.toContain(value);
  }
}

/** Troca o caractere da posição por outro válido em base64url. */
function replaceCharAt(text: string, index: number): string {
  const replacement = text[index] === "A" ? "B" : "A";
  return text.slice(0, index) + replacement + text.slice(index + 1);
}

describe("secrets", () => {
  let key: string;

  beforeEach(() => {
    key = newKey();
    vi.stubEnv("SECRETS_ENCRYPTION_KEY", key);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("cifrar e decifrar", () => {
    it.each([
      ["sentinela", SENTINEL],
      ["vazio", ""],
      ["acentos e emoji", "sênha-çãõ-🔐"],
      ["separadores do formato", "a.b.c:d=e/f+g"],
      ["longo", "x".repeat(100_000)],
    ])("devolve o valor idêntico: %s", (_name, value) => {
      expect(decryptSecret(encryptSecret(value))).toBe(value);
    });

    it("não deixa o texto puro no valor cifrado, nem em base64", () => {
      const payload = encryptSecret(SENTINEL);
      expect(payload).not.toContain(SENTINEL);
      expect(payload).not.toContain(Buffer.from(SENTINEL).toString("base64url"));
      expect(Buffer.from(payload).toString("latin1")).not.toContain(SENTINEL);
    });

    it("não inclui a chave no valor cifrado", () => {
      const payload = encryptSecret(SENTINEL);
      expect(payload).not.toContain(key);
      expect(payload).not.toContain(Buffer.from(key, "base64").toString("base64url"));
    });

    it("gera valor e IV diferentes para o mesmo segredo", () => {
      const payloads = Array.from({ length: 200 }, () => encryptSecret(SENTINEL));
      const ivs = payloads.map((payload) => payload.split(".")[1]);
      expect(new Set(payloads).size).toBe(payloads.length);
      expect(new Set(ivs).size).toBe(payloads.length);
      for (const payload of payloads) {
        expect(decryptSecret(payload)).toBe(SENTINEL);
      }
    });

    it("usa IV de 12 bytes e tag de 16 bytes", () => {
      const [version, iv, tag] = encryptSecret(SENTINEL).split(".");
      expect(version).toBe("v1");
      expect(Buffer.from(iv!, "base64url")).toHaveLength(12);
      expect(Buffer.from(tag!, "base64url")).toHaveLength(16);
    });
  });

  describe("dado adulterado", () => {
    it("recusa a alteração de qualquer caractere do valor", () => {
      const payload = encryptSecret(SENTINEL);
      for (let index = 0; index < payload.length; index++) {
        if (payload[index] === ".") continue;
        const tampered = replaceCharAt(payload, index);
        const error = captureError(() => decryptSecret(tampered));
        expect(["VALOR_CIFRADO_INVALIDO", "DECIFRAGEM_FALHOU"]).toContain(error.code);
        expect(everythingVisible(error)).not.toContain(SENTINEL);
      }
    });

    it("recusa troca de bits no cifrado, com mensagem que não expõe valores", () => {
      const payload = encryptSecret(SENTINEL);
      const [version, iv, tag, ciphertext] = payload.split(".");
      const bytes = Buffer.from(ciphertext!, "base64url");
      bytes[0] = bytes[0]! ^ 0xff;
      const tampered = [version, iv, tag, bytes.toString("base64url")].join(".");

      expectFailure(() => decryptSecret(tampered), "DECIFRAGEM_FALHOU", [SENTINEL, key, tampered]);
    });

    it("recusa cifrado de outro segredo com o IV e a tag originais", () => {
      const [version, iv, tag] = encryptSecret(SENTINEL).split(".");
      const otherCiphertext = encryptSecret("OUTRO-VALOR").split(".")[3];
      const spliced = [version, iv, tag, otherCiphertext].join(".");

      expectFailure(() => decryptSecret(spliced), "DECIFRAGEM_FALHOU", [SENTINEL, "OUTRO-VALOR", key]);
    });

    it("recusa cifrado esvaziado", () => {
      const [version, iv, tag] = encryptSecret(SENTINEL).split(".");
      const emptied = [version, iv, tag, ""].join(".");

      expectFailure(() => decryptSecret(emptied), "DECIFRAGEM_FALHOU", [SENTINEL, key]);
    });

    it("recusa grafia alternativa em base64 que decodifica para os mesmos bytes", () => {
      const [version, iv, tag, ciphertext] = encryptSecret(SENTINEL).split(".");
      // IV de 12 bytes não sobra bits; a tag de 16 bytes sobra 4 bits no último caractere.
      const lastTagChar = tag!.at(-1)!;
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      const alternative = alphabet[alphabet.indexOf(lastTagChar) + 1]!;
      const altTag = tag!.slice(0, -1) + alternative;
      expect(Buffer.from(altTag, "base64url").equals(Buffer.from(tag!, "base64url"))).toBe(true);

      const altered = [version, iv, altTag, ciphertext].join(".");
      expectFailure(() => decryptSecret(altered), "VALOR_CIFRADO_INVALIDO", [SENTINEL, key]);
    });

    it.each([
      ["vazio", ""],
      ["texto puro", SENTINEL],
      ["sem partes", "v1"],
      ["faltando parte", "v1.AAAA.AAAA"],
      ["parte a mais", "v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA.AAAA"],
      ["versão desconhecida", "v2.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA"],
      ["IV curto", "v1.AAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA"],
      ["tag curta", "v1.AAAAAAAAAAAAAAAA.AAAA.AAAA"],
      ["caracteres inválidos", "v1.!!!!.@@@@.####"],
    ])("recusa formato inválido: %s", (_name, payload) => {
      expectFailure(() => decryptSecret(payload), "VALOR_CIFRADO_INVALIDO", [SENTINEL, key]);
    });

    it("recusa tipo diferente de texto", () => {
      expectFailure(() => decryptSecret(null as unknown as string), "VALOR_CIFRADO_INVALIDO", [key]);
    });
  });

  describe("chave errada", () => {
    it("falha ao decifrar sem expor segredo nem chaves", () => {
      const payload = encryptSecret(SENTINEL);
      const otherKey = newKey();
      vi.stubEnv("SECRETS_ENCRYPTION_KEY", otherKey);

      expectFailure(() => decryptSecret(payload), "DECIFRAGEM_FALHOU", [SENTINEL, key, otherKey, payload]);
    });

    it("volta a decifrar com a chave original", () => {
      const payload = encryptSecret(SENTINEL);
      vi.stubEnv("SECRETS_ENCRYPTION_KEY", newKey());
      expect(() => decryptSecret(payload)).toThrow(SecretsCryptoError);

      vi.stubEnv("SECRETS_ENCRYPTION_KEY", key);
      expect(decryptSecret(payload)).toBe(SENTINEL);
    });
  });

  describe("chave ausente", () => {
    it.each([
      ["não definida", undefined],
      ["vazia", ""],
    ])("recusa cifrar, decifrar e validar: %s", (_name, value) => {
      const payload = encryptSecret(SENTINEL);
      vi.stubEnv("SECRETS_ENCRYPTION_KEY", value as string);

      expectFailure(() => encryptSecret(SENTINEL), "CHAVE_AUSENTE", [SENTINEL]);
      expectFailure(() => decryptSecret(payload), "CHAVE_AUSENTE", [SENTINEL, payload]);
      expectFailure(() => assertEncryptionKeyConfigured(), "CHAVE_AUSENTE", [SENTINEL]);
    });

    it("informa o nome da variável para indicar o motivo", () => {
      vi.stubEnv("SECRETS_ENCRYPTION_KEY", "");
      expect(captureError(() => encryptSecret(SENTINEL)).message).toContain("SECRETS_ENCRYPTION_KEY");
    });
  });

  describe("chave inválida", () => {
    const short = randomBytes(16).toString("base64");
    const long = randomBytes(48).toString("base64");
    const valid = randomBytes(32).toString("base64");
    const hex = randomBytes(32).toString("hex");

    it.each([
      ["curta demais", short],
      ["longa demais", long],
      ["hexadecimal", hex],
      ["com caracteres fora do base64", `${valid.slice(0, -2)}!=`],
      ["com espaço no fim", `${valid} `],
      ["com quebra de linha", `${valid}\n`],
      ["sem preenchimento", valid.replace(/=+$/, "")],
      ["texto comum", "CHAVE-SENTINELA-INVALIDA"],
    ])("recusa e não expõe o valor: %s", (_name, invalidKey) => {
      const payload = encryptSecret(SENTINEL);
      vi.stubEnv("SECRETS_ENCRYPTION_KEY", invalidKey);

      expectFailure(() => encryptSecret(SENTINEL), "CHAVE_INVALIDA", [SENTINEL, invalidKey]);
      expectFailure(() => decryptSecret(payload), "CHAVE_INVALIDA", [SENTINEL, invalidKey]);
      expectFailure(() => assertEncryptionKeyConfigured(), "CHAVE_INVALIDA", [invalidKey]);
    });

    it("recusa base64 não canônico de 32 bytes", () => {
      // 32 bytes sobram 2 bits no último caractere antes do "=": A + 1 = B não é canônico.
      const nonCanonical = `${"A".repeat(42)}B=`;
      expect(Buffer.from(nonCanonical, "base64")).toHaveLength(32);
      vi.stubEnv("SECRETS_ENCRYPTION_KEY", nonCanonical);

      expectFailure(() => assertEncryptionKeyConfigured(), "CHAVE_INVALIDA", [nonCanonical]);
    });

    it("aceita a chave no formato do openssl rand -base64 32", () => {
      vi.stubEnv("SECRETS_ENCRYPTION_KEY", valid);
      expect(valid).toHaveLength(44);
      expect(() => assertEncryptionKeyConfigured()).not.toThrow();
    });
  });

  it("recusa cifrar valor que não é texto, sem repetir o valor no erro", () => {
    const notText = 987654321 as unknown as string;
    expectFailure(() => encryptSecret(notText), "SEGREDO_INVALIDO", ["987654321", key]);
  });

  it("não registra nada no console", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );

    decryptSecret(encryptSecret(SENTINEL));
    captureError(() => decryptSecret("invalido"));

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
