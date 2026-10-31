import type { CampoInvalido } from "@/shared/dto";

export type CodigoErroCadastro = "VALIDACAO" | "NAO_ENCONTRADO" | "CONFLITO";

/** Erro esperado de cadastro. A mensagem vai para a resposta e nunca repete o valor recebido. */
export class CadastroError extends Error {
  readonly codigo: CodigoErroCadastro;
  readonly campos?: CampoInvalido[];

  constructor(codigo: CodigoErroCadastro, mensagem: string, campos?: CampoInvalido[]) {
    super(mensagem);
    this.name = "CadastroError";
    this.codigo = codigo;
    this.campos = campos;
  }
}

export function naoEncontrado(entidade: string): CadastroError {
  return new CadastroError("NAO_ENCONTRADO", `${entidade} não encontrado.`);
}
