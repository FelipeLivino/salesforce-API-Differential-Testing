import { lerCorpo, responder } from "@/app/api/_lib/http";
import { getCadastros } from "@/server/services";

export function GET() {
  return responder(() => ({ itens: getCadastros().contextos.listar() }));
}

export function POST(request: Request) {
  return responder(async () => getCadastros().contextos.criar(await lerCorpo(request)), 201);
}
