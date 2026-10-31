import type { ErroResponse } from "@/shared/dto";

const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** O Host precisa ser só `hostname[:porta]`: credenciais ou caminho indicam um valor forjado. */
function hostLocal(host: string | null): boolean {
  const url = host ? URL.parse(`http://${host}`) : null;
  return (
    url !== null &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "" &&
    HOSTS_LOCAIS.has(url.hostname)
  );
}

/** Origin `null` ou inválido não tem hostname que se possa confirmar como local. */
function origemLocal(origin: string): boolean {
  const hostname = URL.parse(origin)?.hostname;
  return hostname !== undefined && HOSTS_LOCAIS.has(hostname);
}

/**
 * Sem login na ferramenta, uma página externa cujo domínio passe a apontar para 127.0.0.1
 * (DNS rebinding) falaria com a API como se fosse local. O Host e o Origin revelam esse domínio.
 * A porta não importa. Sem `matcher`: vale para todas as rotas. A resposta não repete o valor recebido.
 */
export function proxy(request: Request): Response | undefined {
  const origin = request.headers.get("origin");
  if (hostLocal(request.headers.get("host")) && (origin === null || origemLocal(origin))) {
    return undefined;
  }
  const corpo: ErroResponse = {
    erro: {
      codigo: "HOST_RECUSADO",
      mensagem: "Esta ferramenta só aceita acesso por localhost, 127.0.0.1 ou [::1].",
    },
  };
  return Response.json(corpo, { status: 403 });
}
