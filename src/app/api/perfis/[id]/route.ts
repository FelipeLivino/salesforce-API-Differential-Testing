import { lerCorpo, lerId, responder, type ContextoRotaId } from "@/app/api/_lib/http";
import { getCadastros } from "@/server/services";

export function GET(_request: Request, contexto: ContextoRotaId) {
  return responder(async () => getCadastros().perfis.buscar(await lerId(contexto, "Perfil")));
}

export function PATCH(request: Request, contexto: ContextoRotaId) {
  return responder(async () =>
    getCadastros().perfis.editar(await lerId(contexto, "Perfil"), await lerCorpo(request)),
  );
}

export function DELETE(_request: Request, contexto: ContextoRotaId) {
  return responder(async () => getCadastros().perfis.remover(await lerId(contexto, "Perfil")));
}
