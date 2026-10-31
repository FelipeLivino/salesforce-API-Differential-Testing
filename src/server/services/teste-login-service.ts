import type { TesteLoginResponse } from "@/shared/dto";
import type { LoginService } from "../auth/login-service";
import type { ContextosRepository, PerfisRepository } from "../db/repositories";
import { CadastroError, naoEncontrado } from "./erros";

export type TesteLoginService = ReturnType<typeof createTesteLoginService>;

export function createTesteLoginService(
  contextos: Pick<ContextosRepository, "buscarPorId">,
  perfis: Pick<PerfisRepository, "buscarPorId">,
  login: Pick<LoginService, "testLogin">,
) {
  return {
    /** Falha de login é resultado do teste, não erro da rota. Listas explícitas: o token nunca sai. */
    async testar(contextoId: number): Promise<TesteLoginResponse> {
      const contexto = contextos.buscarPorId(contextoId);
      if (!contexto) throw naoEncontrado("Contexto");
      if (contexto.situacao === "arquivado") {
        throw new CadastroError("CONFLITO", "Contexto arquivado não pode ser testado.");
      }
      if (perfis.buscarPorId(contexto.perfilId)?.situacao === "arquivado") {
        throw new CadastroError("CONFLITO", "Contexto de perfil arquivado não pode ser testado.");
      }

      const resultado = await login.testLogin(contextoId);
      if (resultado.ok) {
        return {
          ok: true,
          instanceUrl: resultado.instanceUrl,
          expiresAt: resultado.expiresAt?.toISOString() ?? null,
          expiresAtSource: resultado.expiresAtSource,
          testeToken: resultado.userinfo,
        };
      }
      const { kind, step, httpStatus, error, errorDescription, rawBody, message } = resultado;
      return {
        ok: false,
        kind,
        ...(step !== undefined && { step }),
        ...(httpStatus !== undefined && { httpStatus }),
        ...(error !== undefined && { error }),
        ...(errorDescription !== undefined && { errorDescription }),
        ...(rawBody !== undefined && { rawBody }),
        ...(message !== undefined && { message }),
      };
    },
  };
}
