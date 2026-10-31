import { exigirJson, lerId, responder, type ContextoRotaId } from "@/app/api/_lib/http";
import { getTesteLogin } from "@/server/services";

/** O corpo é ignorado, mas o tipo de conteúdo é exigido: outra origem não pode disparar logins. */
export function POST(request: Request, contexto: ContextoRotaId) {
  return responder(async () => {
    exigirJson(request);
    return getTesteLogin().testar(await lerId(contexto, "Contexto"));
  });
}
