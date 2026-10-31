import { responder } from "@/app/api/_lib/http";
import { listarTiposLogin } from "@/server/services";

export function GET() {
  return responder(() => ({ itens: listarTiposLogin() }));
}
