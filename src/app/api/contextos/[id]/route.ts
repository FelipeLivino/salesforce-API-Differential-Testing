import { lerCorpo, lerId, responder, type ContextoRotaId } from "@/app/api/_lib/http";
import { getCadastros } from "@/server/services";

export function GET(_request: Request, contexto: ContextoRotaId) {
  return responder(async () => getCadastros().contextos.buscar(await lerId(contexto, "Contexto")));
}

export function PATCH(request: Request, contexto: ContextoRotaId) {
  return responder(async () =>
    getCadastros().contextos.editar(await lerId(contexto, "Contexto"), await lerCorpo(request)),
  );
}
