import type { ContextoDto } from "@/shared/dto";
import { encryptSecret } from "../crypto/secrets";
import type {
  AmbientesRepository,
  ContextoRecord,
  ContextosRepository,
  PerfisRepository,
} from "../db/repositories";
import { CadastroError, naoEncontrado } from "./erros";
import type { InvalidadorTokens } from "./portas";
import { exigirObjeto, hostMudou, Validador } from "./validacao";

/** Lista explícita de campos: os valores cifrados nunca entram na resposta. */
function paraDto(contexto: ContextoRecord): ContextoDto {
  return {
    id: contexto.id,
    ambienteId: contexto.ambienteId,
    perfilId: contexto.perfilId,
    url: contexto.url,
    login: contexto.login,
    senhaDefinida: contexto.senhaCifrada.length > 0,
    securityTokenDefinido: contexto.securityTokenCifrado !== null,
    situacao: contexto.situacao,
    criadoEm: contexto.criadoEm,
    atualizadoEm: contexto.atualizadoEm,
  };
}

export type ContextosService = ReturnType<typeof createContextosService>;

export function createContextosService(
  repo: ContextosRepository,
  ambientes: AmbientesRepository,
  perfis: PerfisRepository,
  tokens: InvalidadorTokens,
) {
  function validarAmbiente(id: number | undefined, v: Validador): void {
    if (id !== undefined && !ambientes.buscarPorId(id)) v.erro("ambienteId", "Ambiente não encontrado.");
  }

  /** Perfil arquivado só continua com os contextos que já tem. */
  function validarNovoPerfil(id: number | undefined, v: Validador): void {
    if (id === undefined) return;
    const perfil = perfis.buscarPorId(id);
    if (!perfil) v.erro("perfilId", "Perfil não encontrado.");
    else if (perfil.situacao === "arquivado") {
      throw new CadastroError("CONFLITO", "Perfil arquivado não pode receber contextos.", [
        { campo: "perfilId", mensagem: "Perfil arquivado não pode receber contextos." },
      ]);
    }
  }

  return {
    listar: (): ContextoDto[] => repo.listar().map(paraDto),

    buscar(id: number): ContextoDto {
      const contexto = repo.buscarPorId(id);
      if (!contexto) throw naoEncontrado("Contexto");
      return paraDto(contexto);
    },

    criar(entrada: unknown): ContextoDto {
      const corpo = exigirObjeto(entrada);
      const v = new Validador();
      const ambienteId = v.id(corpo.ambienteId, "ambienteId", "Ambiente");
      const perfilId = v.id(corpo.perfilId, "perfilId", "Perfil");
      const url = v.urlBase(corpo.url, "url", "URL");
      const login = v.textoObrigatorio(corpo.login, "login", "Login");
      const senha = v.segredoObrigatorio(corpo.senha, "senha", "Senha");
      const securityToken = v.segredoOpcional(corpo.securityToken, "securityToken", "Security token");
      validarAmbiente(ambienteId, v);
      validarNovoPerfil(perfilId, v);
      v.concluir();

      return paraDto(
        repo.criar({
          ambienteId: ambienteId!,
          perfilId: perfilId!,
          url: url!,
          login: login!,
          senhaCifrada: encryptSecret(senha!),
          securityTokenCifrado: securityToken === null ? null : encryptSecret(securityToken),
        }),
      );
    },

    editar(id: number, entrada: unknown): ContextoDto {
      const corpo = exigirObjeto(entrada);
      const atual = repo.buscarPorId(id);
      if (!atual) throw naoEncontrado("Contexto");

      const v = new Validador();
      const ambienteId = corpo.ambienteId === undefined ? undefined : v.id(corpo.ambienteId, "ambienteId", "Ambiente");
      const perfilId = corpo.perfilId === undefined ? undefined : v.id(corpo.perfilId, "perfilId", "Perfil");
      const url = corpo.url === undefined ? undefined : v.urlBase(corpo.url, "url", "URL");
      const login = v.textoEditavel(corpo.login, "login", "Login");
      const situacao = v.situacao(corpo.situacao, "situacao");
      if (corpo.senha === null) v.erro("senha", "Senha é obrigatória e não pode ser removida.");
      const senha = v.segredoEditavel(corpo.senha, "senha", "Senha");
      const securityToken = v.segredoEditavel(corpo.securityToken, "securityToken", "Security token");
      if (hostMudou(atual.url, url) && senha === undefined && corpo.senha !== null) {
        v.erro("senha", "Informe a senha de novo: o host da URL mudou.");
      }
      validarAmbiente(ambienteId, v);
      if (perfilId !== atual.perfilId) validarNovoPerfil(perfilId, v);
      v.concluir();

      const atualizado = repo.atualizar(id, {
        ambienteId,
        perfilId,
        url,
        login,
        situacao,
        // Sem senha nova, o valor cifrado atual fica como está, e a chave nem é usada.
        senhaCifrada: senha ? encryptSecret(senha) : undefined,
        securityTokenCifrado: securityToken ? encryptSecret(securityToken) : securityToken,
      })!;
      tokens.invalidate(id);
      return paraDto(atualizado);
    },
  };
}
