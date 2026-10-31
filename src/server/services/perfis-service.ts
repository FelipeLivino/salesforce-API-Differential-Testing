import type { PerfilDto, RemoverPerfilResponse } from "@/shared/dto";
import type { PerfilRecord, PerfisRepository } from "../db/repositories";
import { naoEncontrado } from "./erros";
import type { InvalidadorTokens, ValidadorTipoLogin } from "./portas";
import { exigirObjeto, Validador } from "./validacao";

function paraDto(perfil: PerfilRecord): PerfilDto {
  return {
    id: perfil.id,
    nome: perfil.nome,
    descricao: perfil.descricao,
    tipoLogin: perfil.tipoLogin,
    situacao: perfil.situacao,
    possuiContextos: perfil.possuiContextos,
    criadoEm: perfil.criadoEm,
    atualizadoEm: perfil.atualizadoEm,
  };
}

const TIPO_SEM_ADAPTADOR = "Tipo de login sem adaptador registrado.";

export type PerfisService = ReturnType<typeof createPerfisService>;

export function createPerfisService(
  repo: PerfisRepository,
  tokens: InvalidadorTokens,
  tipoLoginValido: ValidadorTipoLogin,
) {
  return {
    listar: (): PerfilDto[] => repo.listar().map(paraDto),

    buscar(id: number): PerfilDto {
      const perfil = repo.buscarPorId(id);
      if (!perfil) throw naoEncontrado("Perfil");
      return paraDto(perfil);
    },

    criar(entrada: unknown): PerfilDto {
      const corpo = exigirObjeto(entrada);
      const v = new Validador();
      const nome = v.textoObrigatorio(corpo.nome, "nome", "Nome");
      const descricao = v.textoOpcional(corpo.descricao, "descricao", "Descrição");
      const tipoLogin = v.textoObrigatorio(corpo.tipoLogin, "tipoLogin", "Tipo de login");
      const situacao = v.situacao(corpo.situacao, "situacao");
      if (tipoLogin && !tipoLoginValido(tipoLogin)) v.erro("tipoLogin", TIPO_SEM_ADAPTADOR);
      v.concluir();

      return paraDto(
        repo.criar({
          nome: nome!,
          descricao: descricao ?? null,
          tipoLogin: tipoLogin!,
          situacao: situacao ?? "ativo",
        }),
      );
    },

    editar(id: number, entrada: unknown): PerfilDto {
      const corpo = exigirObjeto(entrada);
      const atual = repo.buscarPorId(id);
      if (!atual) throw naoEncontrado("Perfil");

      const v = new Validador();
      const nome = v.textoEditavel(corpo.nome, "nome", "Nome");
      const descricao = v.textoOpcional(corpo.descricao, "descricao", "Descrição");
      const tipoLogin = v.textoEditavel(corpo.tipoLogin, "tipoLogin", "Tipo de login");
      const situacao = v.situacao(corpo.situacao, "situacao");
      // Só valida quando muda: um tipo antigo, já sem adaptador, não impede editar o resto do perfil.
      if (tipoLogin && tipoLogin !== atual.tipoLogin && !tipoLoginValido(tipoLogin)) {
        v.erro("tipoLogin", TIPO_SEM_ADAPTADOR);
      }
      v.concluir();

      const atualizado = repo.atualizar(id, { nome, descricao, tipoLogin, situacao })!;
      // Tipo de login e situação afetam todos os contextos do perfil.
      tokens.invalidateAll();
      return paraDto(atualizado);
    },

    /** Com contexto vinculado, arquiva e informa isso na resposta. Sem nenhum, exclui. */
    remover(id: number): RemoverPerfilResponse {
      const resultado = repo.excluirOuArquivar(id);
      if (!resultado) throw naoEncontrado("Perfil");
      if (resultado === "excluido") return { resultado };
      tokens.invalidateAll();
      return { resultado, perfil: paraDto(repo.buscarPorId(id)!) };
    },
  };
}
