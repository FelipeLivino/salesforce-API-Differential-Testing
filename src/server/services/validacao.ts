import type { CampoInvalido, Situacao, TipoAmbiente } from "@/shared/dto";
import { SITUACOES, TIPOS_AMBIENTE } from "@/shared/dto";
import { CadastroError } from "./erros";

// Nenhuma mensagem repete o valor recebido: um segredo colado no campo errado não pode voltar
// na resposta nem chegar a um log.

export type Corpo = Record<string, unknown>;

export function exigirObjeto(valor: unknown): Corpo {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    throw new CadastroError("VALIDACAO", "O corpo da requisição precisa ser um objeto JSON.");
  }
  return valor as Corpo;
}

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/;

const FEMININOS = new Set(["URL", "Senha"]);
const obrigatorio = (rotulo: string) => `${rotulo} é ${FEMININOS.has(rotulo) ? "obrigatória" : "obrigatório"}.`;

/** https, ou http só em loopback. Recusa qualquer outro esquema, como javascript:. */
const esquemaPermitido = (url: URL) =>
  url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.test(url.hostname));

/** Segredos salvos foram informados para o host antigo: um host novo exige que sejam informados de novo. */
export function hostMudou(atual: string, nova: string | undefined): boolean {
  return nova !== undefined && URL.parse(atual)?.host !== URL.parse(nova)?.host;
}

/** Coleta os problemas de todos os campos, para devolvê-los de uma só vez. */
export class Validador {
  private readonly erros: CampoInvalido[] = [];

  erro(campo: string, mensagem: string): undefined {
    this.erros.push({ campo, mensagem });
    return undefined;
  }

  /** Lança se houver problema. Chame antes de cifrar ou gravar. */
  concluir(): void {
    if (this.erros.length > 0) {
      const resumo = this.erros.map((erro) => erro.mensagem).join(" ");
      throw new CadastroError("VALIDACAO", resumo, this.erros);
    }
  }

  textoObrigatorio(valor: unknown, campo: string, rotulo: string): string | undefined {
    if (valor !== undefined && valor !== null && typeof valor !== "string") {
      return this.erro(campo, `${rotulo} precisa ser um texto.`);
    }
    const texto = valor?.trim();
    return texto ? texto : this.erro(campo, obrigatorio(rotulo));
  }

  /** Edição: ausente mantém; presente segue a regra de obrigatório. */
  textoEditavel(valor: unknown, campo: string, rotulo: string): string | undefined {
    return valor === undefined ? undefined : this.textoObrigatorio(valor, campo, rotulo);
  }

  /** Ausente fica `undefined` (mantém, na edição); nulo ou vazio fica `null` (limpa). */
  textoOpcional(valor: unknown, campo: string, rotulo: string): string | null | undefined {
    if (valor === undefined || valor === null) return valor;
    if (typeof valor !== "string") return this.erro(campo, `${rotulo} precisa ser um texto.`);
    return valor.trim() || null;
  }

  /**
   * URL de base para chamadas: https, ou http só em loopback (servidor falso). Sem credenciais,
   * query ou fragmento, que iriam parar em respostas da API. Remove a barra final.
   */
  urlBase(valor: unknown, campo: string, rotulo: string): string | undefined {
    const texto = this.textoObrigatorio(valor, campo, rotulo);
    if (texto === undefined) return undefined;

    const url = URL.parse(texto);
    if (!url) return this.erro(campo, `${rotulo} não é uma URL válida.`);
    if (!esquemaPermitido(url)) return this.erro(campo, `${rotulo} precisa usar https (http só em endereço local).`);
    if (url.username || url.password || url.search || url.hash) {
      return this.erro(campo, `${rotulo} não pode conter credenciais, query ou fragmento.`);
    }
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  }

  /** Mantida como digitada: precisa coincidir exatamente com a cadastrada no app. */
  redirectUri(valor: unknown, campo: string, rotulo: string): string | null | undefined {
    const texto = this.textoOpcional(valor, campo, rotulo);
    if (!texto) return texto;
    const url = URL.parse(texto);
    if (!url) return this.erro(campo, `${rotulo} não é uma URL válida.`);
    if (!esquemaPermitido(url)) return this.erro(campo, `${rotulo} precisa usar https (http só em endereço local).`);
    if (url.username || url.password) return this.erro(campo, `${rotulo} não pode conter credenciais.`);
    return texto;
  }

  tipoAmbiente(valor: unknown, campo: string): TipoAmbiente | undefined {
    if (valor === undefined || valor === null || valor === "") {
      return this.erro(campo, "Tipo é obrigatório.");
    }
    if (!TIPOS_AMBIENTE.includes(valor as TipoAmbiente)) {
      return this.erro(campo, `Tipo inválido. Use: ${TIPOS_AMBIENTE.join(" ou ")}.`);
    }
    return valor as TipoAmbiente;
  }

  situacao(valor: unknown, campo: string): Situacao | undefined {
    if (valor === undefined) return undefined;
    if (!SITUACOES.includes(valor as Situacao)) {
      return this.erro(campo, `Situação inválida. Use: ${SITUACOES.join(" ou ")}.`);
    }
    return valor as Situacao;
  }

  id(valor: unknown, campo: string, rotulo: string): number | undefined {
    if (valor === undefined || valor === null || valor === "") {
      return this.erro(campo, `${rotulo} é obrigatório.`);
    }
    if (!Number.isSafeInteger(valor) || (valor as number) <= 0) {
      return this.erro(campo, `${rotulo} é inválido.`);
    }
    return valor as number;
  }

  /** Segredo obrigatório na criação. O valor nunca é alterado, nem por trim. */
  segredoObrigatorio(valor: unknown, campo: string, rotulo: string): string | undefined {
    if (valor !== undefined && valor !== null && typeof valor !== "string") {
      return this.erro(campo, `${rotulo} precisa ser um texto.`);
    }
    return valor?.trim() ? valor : this.erro(campo, obrigatorio(rotulo));
  }

  /** Segredo opcional na criação: ausente, nulo ou em branco significa não definido. */
  segredoOpcional(valor: unknown, campo: string, rotulo: string): string | null {
    if (valor !== undefined && valor !== null && typeof valor !== "string") {
      this.erro(campo, `${rotulo} precisa ser um texto.`);
      return null;
    }
    return valor?.trim() ? valor : null;
  }

  /** Edição de segredo: ausente ou em branco mantém (`undefined`); `null` remove. */
  segredoEditavel(valor: unknown, campo: string, rotulo: string): string | null | undefined {
    if (valor === undefined || valor === null) return valor;
    if (typeof valor !== "string") return this.erro(campo, `${rotulo} precisa ser um texto.`);
    return valor.trim() ? valor : undefined;
  }
}
