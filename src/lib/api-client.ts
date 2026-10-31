import type {
  AmbienteDto,
  CampoInvalido,
  ContextoDto,
  CriarAmbienteRequest,
  CriarContextoRequest,
  CriarPerfilRequest,
  EditarAmbienteRequest,
  EditarContextoRequest,
  EditarPerfilRequest,
  ErroResponse,
  ListaResponse,
  PerfilDto,
  RemoverPerfilResponse,
  StatusResponse,
  TesteLoginResponse,
  TipoLoginDto,
} from "@/shared/dto";

/** Erro de uma chamada às rotas, com a mensagem real recebida. */
export class ErroApi extends Error {
  readonly status?: number;
  readonly codigo?: string;
  readonly campos: CampoInvalido[];

  constructor(mensagem: string, detalhes: { status?: number; codigo?: string; campos?: CampoInvalido[] } = {}) {
    super(mensagem);
    this.name = "ErroApi";
    this.status = detalhes.status;
    this.codigo = detalhes.codigo;
    this.campos = detalhes.campos ?? [];
  }
}

export function paraErroApi(erro: unknown): ErroApi {
  return erro instanceof ErroApi ? erro : new ErroApi(erro instanceof Error ? erro.message : String(erro));
}

const LIMITE_TRECHO = 500;

function ehErroResponse(corpo: unknown): corpo is ErroResponse {
  const erro = (corpo as Partial<ErroResponse> | null)?.erro;
  return typeof erro?.mensagem === "string";
}

async function chamar<T>(caminho: string, metodo = "GET", corpo?: unknown): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, {
      method: metodo,
      cache: "no-store",
      // Exigido pelas rotas de escrita e por Testar login (decisões C12 e C16).
      ...(metodo !== "GET" && {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo ?? {}),
      }),
    });
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    throw new ErroApi(`Sem resposta do serviço local: ${motivo}`);
  }

  const texto = await resposta.text();
  let dados: unknown;
  let jsonValido = true;
  try {
    dados = JSON.parse(texto);
  } catch {
    jsonValido = false;
  }

  if (!resposta.ok) {
    if (ehErroResponse(dados)) {
      const { mensagem, codigo, campos } = dados.erro;
      throw new ErroApi(mensagem, { status: resposta.status, codigo, campos });
    }
    throw new ErroApi(texto.slice(0, LIMITE_TRECHO) || "Resposta de erro sem corpo.", { status: resposta.status });
  }
  if (!jsonValido) {
    throw new ErroApi(`Resposta que não é JSON: ${texto.slice(0, LIMITE_TRECHO)}`, { status: resposta.status });
  }
  return dados as T;
}

const listar = async <T>(caminho: string): Promise<T[]> => (await chamar<ListaResponse<T>>(caminho)).itens;

export const api = {
  ambientes: {
    listar: () => listar<AmbienteDto>("/api/ambientes"),
    criar: (dados: CriarAmbienteRequest) => chamar<AmbienteDto>("/api/ambientes", "POST", dados),
    editar: (id: number, dados: EditarAmbienteRequest) => chamar<AmbienteDto>(`/api/ambientes/${id}`, "PATCH", dados),
  },
  perfis: {
    listar: () => listar<PerfilDto>("/api/perfis"),
    criar: (dados: CriarPerfilRequest) => chamar<PerfilDto>("/api/perfis", "POST", dados),
    editar: (id: number, dados: EditarPerfilRequest) => chamar<PerfilDto>(`/api/perfis/${id}`, "PATCH", dados),
    remover: (id: number) => chamar<RemoverPerfilResponse>(`/api/perfis/${id}`, "DELETE"),
  },
  contextos: {
    listar: () => listar<ContextoDto>("/api/contextos"),
    criar: (dados: CriarContextoRequest) => chamar<ContextoDto>("/api/contextos", "POST", dados),
    editar: (id: number, dados: EditarContextoRequest) => chamar<ContextoDto>(`/api/contextos/${id}`, "PATCH", dados),
    testarLogin: (id: number) => chamar<TesteLoginResponse>(`/api/contextos/${id}/testar-login`, "POST"),
  },
  status: {
    obter: () => chamar<StatusResponse>("/api/status"),
  },
  tiposLogin: {
    listar: () => listar<TipoLoginDto>("/api/tipos-login"),
  },
};
