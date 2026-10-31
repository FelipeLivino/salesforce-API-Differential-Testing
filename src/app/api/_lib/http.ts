import { CadastroError } from "@/server/services";
import { SecretsCryptoError } from "@/server/crypto/secrets";
import type { CodigoErro, ErroResponse } from "@/shared/dto";

const STATUS: Record<CodigoErro, number> = {
  VALIDACAO: 400,
  HOST_RECUSADO: 403,
  NAO_ENCONTRADO: 404,
  CONFLITO: 409,
  TIPO_DE_CONTEUDO: 415,
  INTERNO: 500,
  CHAVE_CRIPTOGRAFIA: 503,
};

function erroJson(codigo: CodigoErro, mensagem: string, campos?: ErroResponse["erro"]["campos"]): Response {
  const body: ErroResponse = { erro: { codigo, mensagem, ...(campos && { campos }) } };
  return Response.json(body, { status: STATUS[codigo] });
}

class TipoDeConteudoError extends Error {}

function paraResposta(error: unknown): Response {
  if (error instanceof TipoDeConteudoError) {
    return erroJson("TIPO_DE_CONTEUDO", "Envie o corpo como application/json.");
  }
  if (error instanceof CadastroError) return erroJson(error.codigo, error.message, error.campos);
  // As mensagens desse erro são fixas: citam o motivo, nunca a chave ou o segredo.
  if (error instanceof SecretsCryptoError) return erroJson("CHAVE_CRIPTOGRAFIA", error.message);

  // Só nome e código: a mensagem de um erro inesperado pode carregar dados da requisição.
  const { name, code } = error as { name?: unknown; code?: unknown };
  console.error("Erro interno na API de cadastros:", String(name), code === undefined ? "" : String(code));
  return erroJson("INTERNO", "Erro interno. Consulte os logs do serviço.");
}

/** Executa a ação e converte o resultado ou o erro na resposta JSON. */
export async function responder(acao: () => unknown, status = 200): Promise<Response> {
  try {
    return Response.json(await acao(), { status });
  } catch (error) {
    return paraResposta(error);
  }
}

/**
 * Exigir application/json força o preflight do navegador, que não é autorizado: assim, uma página
 * de outra origem não consegue gravar cadastros nesta ferramenta local, que não tem login.
 */
export function exigirJson(request: Request): void {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new TipoDeConteudoError();
}

export async function lerCorpo(request: Request): Promise<unknown> {
  exigirJson(request);
  try {
    return await request.json();
  } catch {
    // Mensagem própria: a do parser repete um trecho do corpo, que pode conter um segredo.
    throw new CadastroError("VALIDACAO", "O corpo da requisição não é um JSON válido.");
  }
}

export interface ContextoRotaId {
  params: Promise<{ id: string }>;
}

/** Id que não é um inteiro positivo não corresponde a nenhum cadastro. */
export async function lerId({ params }: ContextoRotaId, entidade: string): Promise<number> {
  const { id } = await params;
  const numero = /^[1-9]\d*$/.test(id) ? Number(id) : Number.NaN;
  if (!Number.isSafeInteger(numero)) throw new CadastroError("NAO_ENCONTRADO", `${entidade} não encontrado.`);
  return numero;
}
