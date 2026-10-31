import { lerCorpo, lerId, responder, type ContextoRotaId } from "@/app/api/_lib/http";
import { getCadastros } from "@/server/services";

export function GET(_request: Request, contexto: ContextoRotaId) {
  return responder(async () => getCadastros().ambientes.buscar(await lerId(contexto, "Ambiente")));
}

export function PATCH(request: Request, contexto: ContextoRotaId) {
  return responder(async () =>
    getCadastros().ambientes.editar(await lerId(contexto, "Ambiente"), await lerCorpo(request)),
  );
}
