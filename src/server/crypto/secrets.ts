import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_ENV_VAR = "SECRETS_ENCRYPTION_KEY";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

// Formato gravado no banco: v1.<iv>.<tag>.<cifrado>, em base64url sem preenchimento.
// A versão entra como dado autenticado, para que não possa ser trocada sem detecção.
const FORMAT_VERSION = "v1";
const AAD = Buffer.from(FORMAT_VERSION, "utf8");

export type SecretsCryptoErrorCode =
  | "CHAVE_AUSENTE"
  | "CHAVE_INVALIDA"
  | "SEGREDO_INVALIDO"
  | "VALOR_CIFRADO_INVALIDO"
  | "DECIFRAGEM_FALHOU";

const MESSAGES: Record<SecretsCryptoErrorCode, string> = {
  CHAVE_AUSENTE: `${KEY_ENV_VAR} não está definida no .env. Nenhum segredo pode ser cifrado ou decifrado.`,
  CHAVE_INVALIDA: `${KEY_ENV_VAR} é inválida: precisa ter ${KEY_BYTES} bytes em base64. Gere com: openssl rand -base64 ${KEY_BYTES}`,
  SEGREDO_INVALIDO: "O segredo a cifrar precisa ser um texto.",
  VALOR_CIFRADO_INVALIDO: "O valor cifrado salvo está em formato inválido ou foi adulterado.",
  DECIFRAGEM_FALHOU: `Não foi possível decifrar o segredo: o valor salvo foi adulterado ou ${KEY_ENV_VAR} é diferente da chave usada ao cifrar.`,
};

/**
 * Erro de criptografia com mensagem fixa: nunca carrega segredo, chave ou valor
 * cifrado, nem a exceção original como `cause`.
 */
export class SecretsCryptoError extends Error {
  readonly code: SecretsCryptoErrorCode;

  constructor(code: SecretsCryptoErrorCode) {
    super(MESSAGES[code]);
    this.name = "SecretsCryptoError";
    this.code = code;
  }
}

/** Lê a chave a cada uso, para que ela não fique guardada no módulo. */
function loadKey(): Buffer {
  const raw = process.env[KEY_ENV_VAR];
  if (raw === undefined || raw === "") {
    throw new SecretsCryptoError("CHAVE_AUSENTE");
  }
  const key = Buffer.from(raw, "base64");
  // Buffer.from ignora caracteres inválidos; comparar a recodificação recusa esses casos.
  if (key.length !== KEY_BYTES || key.toString("base64") !== raw) {
    throw new SecretsCryptoError("CHAVE_INVALIDA");
  }
  return key;
}

/** Decodifica exigindo a forma canônica: duas grafias não podem valer para os mesmos bytes. */
function decodeSegment(segment: string): Buffer {
  const bytes = Buffer.from(segment, "base64url");
  if (bytes.toString("base64url") !== segment) {
    throw new SecretsCryptoError("VALOR_CIFRADO_INVALIDO");
  }
  return bytes;
}

function parsePayload(payload: string): { iv: Buffer; tag: Buffer; ciphertext: Buffer } {
  if (typeof payload !== "string") {
    throw new SecretsCryptoError("VALOR_CIFRADO_INVALIDO");
  }
  const [version, ivPart, tagPart, ciphertextPart, ...rest] = payload.split(".");
  if (
    version !== FORMAT_VERSION ||
    ivPart === undefined ||
    tagPart === undefined ||
    ciphertextPart === undefined ||
    rest.length > 0
  ) {
    throw new SecretsCryptoError("VALOR_CIFRADO_INVALIDO");
  }
  const iv = decodeSegment(ivPart);
  const tag = decodeSegment(tagPart);
  const ciphertext = decodeSegment(ciphertextPart);
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretsCryptoError("VALOR_CIFRADO_INVALIDO");
  }
  return { iv, tag, ciphertext };
}

/**
 * Valida a chave sem cifrar nada. Serve para avisar o motivo antes de aceitar um
 * cadastro; lança SecretsCryptoError se a chave estiver ausente ou inválida.
 */
export function assertEncryptionKeyConfigured(): void {
  loadKey();
}

/** Cifra um segredo com IV aleatório próprio. Sem chave válida, lança e nada é produzido. */
export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  if (typeof plaintext !== "string") {
    throw new SecretsCryptoError("SEGREDO_INVALIDO");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    FORMAT_VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Decifra um valor gerado por encryptSecret. Com dado adulterado ou chave diferente,
 * lança SecretsCryptoError e nenhum texto é devolvido. O GCM não distingue esses dois
 * casos, por isso a mensagem cita ambos.
 */
export function decryptSecret(payload: string): string {
  const key = loadKey();
  const { iv, tag, ciphertext } = parsePayload(payload);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretsCryptoError("DECIFRAGEM_FALHOU");
  }
}
