import { lerCorpo, responder } from "@/app/api/_lib/http";
import { getCadastros } from "@/server/services";

export function GET() {
  return responder(() => ({ itens: getCadastros().ambientes.listar() }));
}

export function POST(request: Request) {
  return responder(async () => getCadastros().ambientes.criar(await lerCorpo(request)), 201);
}
