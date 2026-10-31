import { responder } from "@/app/api/_lib/http";
import { statusDoServico } from "@/server/services";

// A chave é lida a cada chamada: a resposta não pode ser fixada no build.
export const dynamic = "force-dynamic";

export function GET() {
  return responder(() => statusDoServico());
}
