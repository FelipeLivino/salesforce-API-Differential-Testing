const MASK = "***";
const MAX_RAW_BODY_CHARS = 2000;

type Secrets = ReadonlyArray<string | undefined>;

// Campos cujo valor é sempre sensível, mesmo quando não conhecemos o valor de antemão.
const SENSITIVE_NAMES =
  "access_token|refresh_token|id_token|code_verifier|password|client_secret|security_token|token|" +
  "accessToken|refreshToken|clientSecret|codeVerifier";
// Nomes comuns em texto livre ("status code=400"): valores como 400 e invalid_grant continuam legíveis.
const COMMON_VALUE_NAMES = "code|sid|signature";
const NAMES = `${SENSITIVE_NAMES}|${COMMON_VALUE_NAMES}`;

// Número de status, ou identificador de erro com sublinhado, como invalid_grant e INVALID_SESSION_ID.
const COMMON_VALUE = /^(?:\d{1,5}|[a-z]+(?:_[a-z]+)+)$/i;
const ALLOWS_COMMON_VALUE = new RegExp(`^(?:${COMMON_VALUE_NAMES})$`, "i");
const EXACT_NAME = new RegExp(`^(?:${NAMES})$`, "i");
const FINAL_PUNCTUATION = /[.,;:!?)\]}]*$/;
// Em JSON, errorCode também é lido pela estrutura. Em texto livre, continua fora dos nomes.
const JSON_FIELD_NAME = new RegExp(`^(?:${NAMES}|errorCode)$`, "i");
const ERROR_CODE_NAME = /^(?:code|errorCode)$/i;
const ISSUED_TOKEN_NAME = /^(?:access_token|refresh_token|accessToken|refreshToken)$/i;

const MAX_ERROR_CODE_CHARS = 32;
const ERROR_CODE_WORD = "(?:[A-Z]+|[a-z]+|(?:[A-Z][a-z]+)+)";
// Decisão S13: palavras de uma só caixa ou em PascalCase, com sufixo numérico opcional, ou um número de status.
const ERROR_CODE = new RegExp(`^(?:\\d{1,5}|${ERROR_CODE_WORD}(?:[_.-]${ERROR_CODE_WORD})*(?:[_.-]?\\d{1,6})?)$`);
// Abaixo disso, um segredo conhecido só é substituído como palavra inteira (decisão S15).
const MIN_SUBSTRING_SECRET_CHARS = 6;

// O texto pode estar puro, em URL (também codificada duas vezes), em JSON ou em HTML.
const BEFORE_NAME = String.raw`(?:(?<![a-z0-9])|(?<=%[0-9a-f]{2})|(?<=\\[nrt])|(?<=\\u00[0-9a-f]{2}))`;
const QUOTE = String.raw`\\*["'${"`"}]|%(?:25)*2[27]|&quot;|&apos;|&#0*3[49];|&#x0*2[27];|\\u00(?:22|27)`;
const URL_SPACE = String.raw`\+|%(?:25)*20`;
const COLON = String.raw`[ \t]*(?::|&#0*58;|&#x0*3a;|&colon;|\\u003a|%(?:25)*3a)`;
const STARTS_WITH_COLON = new RegExp(`^${COLON}`, "i");
const SEPARATOR = [
  String.raw`${COLON}(?:[ \t]|${URL_SPACE})*`,
  String.raw`[ \t]+=[ \t]*`,
  String.raw`(?:=|&#0*61;|&#x0*3d;|&equals;|\\u003d|%(?:25)*3d)(?:${URL_SPACE})*`,
].join("|");
// Sem aspas, o valor vai até um espaço, &, aspas, < ou >, ou até uma sequência de escape do JSON.
const BARE_VALUE = String.raw`(?:[^\s&"'${"`"}<>\\]|\\\\|\\(?![nrtu"']))+`;

const NAMED_VALUE = new RegExp(
  `${BEFORE_NAME}(?<head>(?<name>${NAMES})(?<nameQuote>${QUOTE})?(?<separator>${SEPARATOR})[\\[({]*)` +
    String.raw`(?:(?<quote>${QUOTE})(?<quoted>[^\n]*?)(?<close>(?<!\\)\k<quote>|$)|(?<bare>${BARE_VALUE}))`,
  "gim",
);
const XML_ELEMENT = new RegExp(`(<(${NAMES})>)([^<]*)(</)`, "gi");
const AUTH_HEADER = /(Authorization\s*[:=]\s*(?:Bearer|Basic)\s+)[^\s"']+/gi;
const BEARER_VALUE = /(Bearer\s+)[^\s"']{16,}/gi;

function keepsValue(name: string, value: string): boolean {
  return value === "" || (ALLOWS_COMMON_VALUE.test(name) && COMMON_VALUE.test(value));
}

/** Decisão S13: em JSON, um código de erro continua legível. O que parecer segredo não. */
function keepsJsonValue(name: string, value: string): boolean {
  if (ERROR_CODE_NAME.test(name)) {
    return value === "" || (value.length <= MAX_ERROR_CODE_CHARS && ERROR_CODE.test(value));
  }
  return keepsValue(name, value);
}

/** Decisão S14: 16 ou mais caracteres, ou mistura de letras e dígitos. */
function looksSecret(value: string): boolean {
  return value.length >= 16 || (/\p{L}/u.test(value) && /\d/.test(value));
}

interface NamedValueGroups {
  head: string;
  name: string;
  nameQuote?: string;
  separator: string;
  quote?: string;
  quoted?: string;
  close?: string;
  bare?: string;
}

/** `=` mascara sempre; `"nome":` segue a regra de JSON; `nome:` é prosa e só mascara o que parecer segredo. */
function keepsNamedValue(groups: NamedValueGroups, value: string): boolean {
  const { name, nameQuote, separator, bare } = groups;
  if (!STARTS_WITH_COLON.test(separator)) {
    return keepsValue(name, value);
  }
  if (nameQuote !== undefined) {
    return (bare !== undefined && /^(?:null|true|false)$/.test(value)) || keepsJsonValue(name, value);
  }
  return keepsValue(name, value) || !looksSecret(value);
}

function maskNamedValue(match: string, ...rest: unknown[]): string {
  const groups = rest.at(-1) as NamedValueGroups;
  const { head, quote, quoted, close, bare } = groups;
  if (quote !== undefined) {
    return keepsNamedValue(groups, quoted ?? "") ? match : `${head}${quote}${MASK}${close ?? ""}`;
  }
  const value = bare ?? "";
  const punctuation = FINAL_PUNCTUATION.exec(value)?.[0] ?? "";
  const core = value.slice(0, value.length - punctuation.length);
  return keepsNamedValue(groups, core) ? match : `${head}${MASK}${punctuation}`;
}

function maskXmlElement(match: string, open: string, name: string, value: string, close: string): string {
  return keepsValue(name, value) ? match : `${open}${MASK}${close}`;
}

function unicodeEscapes(text: string, hex: (code: string) => string): string {
  return text.replace(/[^\x00-\x7f]/g, (char) => `\\u${hex(char.charCodeAt(0).toString(16).padStart(4, "0"))}`);
}

/** Grafias usuais do JSON: `\/`, `\"` e `\uXXXX` de não ASCII, em minúsculas ou maiúsculas. */
function jsonSpellings(secret: string): string[] {
  const plain = JSON.stringify(secret).slice(1, -1);
  const unicode = [plain, unicodeEscapes(plain, (h) => h), unicodeEscapes(plain, (h) => h.toUpperCase())];
  return unicode.flatMap((text) => [text, text.replace(/\//g, "\\/")]);
}

/** Grafias usuais do HTML: `&amp;`, `&lt;`, `&gt;`, aspas como `&quot;` ou `&#34;`, e apóstrofo como `&#39;` ou puro. */
function htmlSpellings(secret: string): string[] {
  const base = secret.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return ["&quot;", "&#34;"].flatMap((quote) => {
    const quoted = base.replace(/"/g, quote);
    return [quoted, quoted.replace(/'/g, "&#39;")];
  });
}

/** Grafias em que um segredo pode voltar em uma resposta: pura, em URL, em formulário, em JSON e em HTML. */
function spellings(secret: string): string[] {
  const encoded = encodeURIComponent(secret);
  return [
    secret,
    encoded,
    encoded.replace(/%[0-9A-F]{2}/g, (hex) => hex.toLowerCase()),
    encodeURIComponent(encoded),
    new URLSearchParams({ v: secret }).toString().slice(2),
    ...jsonSpellings(secret),
    ...htmlSpellings(secret),
  ];
}

type KnownMask = (text: string) => string;

/** Palavra inteira: sem letra, dígito ou sublinhado ao lado, ignorando um escape de JSON ou de URL antes dela. */
function wholeWord(spelling: string): RegExp {
  const literal = spelling.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(String.raw`(?:(?<![\p{L}\p{N}_])|(?<=%[0-9a-fA-F]{2})|(?<=\\[nrt]))${literal}(?![\p{L}\p{N}_])`, "gu");
}

function knownMask(secrets: Secrets): KnownMask {
  const known = [...new Set(secrets)]
    .filter((secret): secret is string => typeof secret === "string" && secret !== "" && !MASK.includes(secret))
    .flatMap((secret) =>
      [...new Set(spellings(secret))].map((spelling) => ({
        spelling,
        pattern: secret.length < MIN_SUBSTRING_SECRET_CHARS ? wholeWord(spelling) : null,
      })),
    )
    // Do mais longo para o mais curto: um segredo contido em outro não deixa sobra visível.
    .sort((a, b) => b.spelling.length - a.spelling.length);

  return (text) =>
    known.reduce(
      (result, { spelling, pattern }) =>
        pattern === null ? result.split(spelling).join(MASK) : result.replace(pattern, MASK),
      text,
    );
}

function maskNamesInText(text: string): string {
  return text
    .replace(NAMED_VALUE, maskNamedValue)
    .replace(XML_ELEMENT, maskXmlElement)
    .replace(AUTH_HEADER, `$1${MASK}`)
    .replace(BEARER_VALUE, `$1${MASK}`);
}

function parseJsonContainer(text: string): boolean {
  if (!/^\s*[{[]/.test(text)) {
    return false;
  }
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** Texto de um valor JSON: pode ser outro JSON, serializado dentro da string, ou texto livre. */
function maskJsonString(token: string, maskKnown: KnownMask): string {
  const decoded = JSON.parse(token) as string;
  if (parseJsonContainer(decoded)) {
    const masked = maskJsonText(decoded, maskKnown);
    return masked === decoded ? token : JSON.stringify(masked);
  }
  return `"${maskNamesInText(maskKnown(token.slice(1, -1)))}"`;
}

interface JsonFrame {
  isObject: boolean;
  /** Nome sensível acima deste nível: tudo que estiver abaixo dele é valor do campo. */
  inherited: string | null;
  expectsKey: boolean;
  key: string | null;
}

const JSON_TOKEN = /"(?:[^"\\]|\\.)*"|[{}[\],:]|[^\s{}[\],:"]+/g;

/**
 * Percorre um JSON válido e troca os valores no próprio texto, sem serializar de novo: espaços,
 * ordem e escapes do corpo original continuam iguais (decisão 3). `null` e booleanos não são segredo.
 */
function maskJsonText(text: string, maskKnown: KnownMask): string {
  const frames: JsonFrame[] = [];
  const masked = text.replace(JSON_TOKEN, (token) => {
    const frame = frames.at(-1);
    if (token === ":") {
      return token;
    }
    if (token === ",") {
      if (frame) {
        frame.expectsKey = frame.isObject;
      }
      return token;
    }
    if (token === "}" || token === "]") {
      frames.pop();
      return token;
    }
    if (frame?.expectsKey) {
      frame.key = JSON.parse(token) as string;
      frame.expectsKey = false;
      return maskKnown(token);
    }
    const name = frame?.key && JSON_FIELD_NAME.test(frame.key) ? frame.key : (frame?.inherited ?? null);
    if (token === "{" || token === "[") {
      frames.push({ isObject: token === "{", inherited: name, expectsKey: token === "{", key: null });
      return token;
    }
    if (token === "true" || token === "false" || token === "null") {
      return token;
    }
    const isString = token.startsWith('"');
    if (name !== null) {
      const value = isString ? (JSON.parse(token) as string) : token;
      return keepsJsonValue(name, value) ? token : `"${MASK}"`;
    }
    return isString ? maskJsonString(token, maskKnown) : token;
  });
  // Pega o que a leitura por valor não alcança: número e valor mantido iguais a um segredo conhecido.
  return maskKnown(masked);
}

/**
 * Mascara os segredos conhecidos e os campos sensíveis pelo nome. O restante do texto
 * é preservado sem alteração, para que o erro real do Salesforce continue legível.
 */
export function redact(text: string, secrets: Secrets = []): string {
  const maskKnown = knownMask(secrets);
  return parseJsonContainer(text) ? maskJsonText(text, maskKnown) : maskNamesInText(maskKnown(text));
}

/** Mascara antes de truncar, para que o corte não esconda parte de um segredo do mascaramento. */
export function redactRawBody(text: string, secrets: Secrets = []): string {
  const redacted = redact(text, secrets);
  return redacted.length > MAX_RAW_BODY_CHARS
    ? `${redacted.slice(0, MAX_RAW_BODY_CHARS)}... [truncado]`
    : redacted;
}

function collectSecrets(value: unknown, isName: RegExp, under: string | null): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectSecrets(item, isName, under));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => collectSecrets(item, isName, isName.test(key) ? key : under));
  }
  if (under === null || (typeof value !== "string" && typeof value !== "number")) {
    return [];
  }
  return keepsValue(under, String(value)) ? [] : [String(value)];
}

/**
 * Valores de campos sensíveis de uma resposta de SUCESSO, em qualquer nível, inclusive em objetos e
 * listas sob o nome sensível. Viram segredos conhecidos antes de redigir o restante, pois o servidor
 * pode repeti-los em outro campo. Não use em resposta de erro (decisão S12).
 */
export function secretsInJson(value: unknown): string[] {
  return collectSecrets(value, EXACT_NAME, null);
}

/**
 * Resposta contraditória, HTTP 2xx com campo `error`: o token pode ser real, mas o erro precisa continuar
 * legível. Só access_token e refresh_token, e só com aspecto de segredo (decisão S12).
 */
export function issuedTokensInJson(value: unknown): string[] {
  return collectSecrets(value, ISSUED_TOKEN_NAME, null).filter(looksSecret);
}

export interface MaskableOutput {
  error?: string | undefined;
  errorDescription?: string | undefined;
  rawBody?: string | undefined;
  message?: string | undefined;
  instanceUrl?: string | undefined;
}

/** Ponto único de saída: todo campo textual que chega à API passa aqui, com os segredos conhecidos. */
export function maskOutput<T extends MaskableOutput>(output: T, secrets: Secrets): T {
  const masked: MaskableOutput = { ...output };
  for (const field of ["error", "errorDescription", "instanceUrl"] as const) {
    const value = output[field];
    if (typeof value === "string") {
      masked[field] = redact(value, secrets);
    }
  }
  if (typeof output.message === "string") {
    // `message` é texto da própria ferramenta: um segredo curto, como "a", corromperia a frase (decisão S15).
    masked.message = redact(
      output.message,
      secrets.filter((secret) => secret !== undefined && secret.length >= MIN_SUBSTRING_SECRET_CHARS),
    );
  }
  if (typeof output.rawBody === "string") {
    masked.rawBody = redactRawBody(output.rawBody, secrets);
  }
  return masked as T;
}
