// Contratos JSON das rotas de cadastro e de teste de login, usados por frontend e backend.
// Este arquivo não importa nada do servidor e pode ser usado no navegador.
//
// Segredos (senha, Client Secret e security token) só entram em requisições. As respostas
// informam apenas se estão definidos.
//
// Edição (PATCH): campo ausente mantém o valor atual. Em segredo, texto vazio também mantém,
// e `null` remove quando o segredo é opcional. Em texto opcional, `null` ou vazio limpa.
// Exceção: se o host da URL mudar, a senha do contexto e o Client Secret salvo do ambiente
// precisam vir de novo. O Client Secret também pode ser removido com `null`.

export const TIPOS_AMBIENTE = ["sandbox", "producao"] as const;
export type TipoAmbiente = (typeof TIPOS_AMBIENTE)[number];

export const SITUACOES = ["ativo", "arquivado"] as const;
export type Situacao = (typeof SITUACOES)[number];

// --- Ambiente e app OAuth ---

export interface AppOAuthDto {
  clientId: string;
  redirectUri: string | null;
  clientSecretDefinido: boolean;
}

export interface AmbienteDto {
  id: number;
  url: string;
  tipo: TipoAmbiente;
  app: AppOAuthDto;
  criadoEm: string;
  atualizadoEm: string;
}

export interface CriarAmbienteRequest {
  url: string;
  tipo: TipoAmbiente;
  app: {
    clientId: string;
    clientSecret?: string | null;
    redirectUri?: string | null;
  };
}

export interface EditarAmbienteRequest {
  url?: string;
  tipo?: TipoAmbiente;
  app?: {
    clientId?: string;
    clientSecret?: string | null;
    redirectUri?: string | null;
  };
}

// --- Perfil ---

/** `tipoLogin` é texto livre de propósito: os tipos vêm do registro de adaptadores, não de um enum. */
export interface PerfilDto {
  id: number;
  nome: string;
  descricao: string | null;
  tipoLogin: string;
  situacao: Situacao;
  /** Com contexto vinculado, ativo ou arquivado, DELETE arquiva em vez de excluir. */
  possuiContextos: boolean;
  criadoEm: string;
  atualizadoEm: string;
}

export interface CriarPerfilRequest {
  nome: string;
  descricao?: string | null;
  tipoLogin: string;
  situacao?: Situacao;
}

export interface EditarPerfilRequest {
  nome?: string;
  descricao?: string | null;
  tipoLogin?: string;
  situacao?: Situacao;
}

/** Resposta de DELETE /api/perfis/{id}. */
export type RemoverPerfilResponse =
  | { resultado: "excluido" }
  | { resultado: "arquivado"; perfil: PerfilDto };

// --- Contexto ---

export interface ContextoDto {
  id: number;
  ambienteId: number;
  perfilId: number;
  url: string;
  login: string;
  senhaDefinida: boolean;
  securityTokenDefinido: boolean;
  situacao: Situacao;
  criadoEm: string;
  atualizadoEm: string;
}

export interface CriarContextoRequest {
  ambienteId: number;
  perfilId: number;
  url: string;
  login: string;
  senha: string;
  securityToken?: string | null;
}

export interface EditarContextoRequest {
  ambienteId?: number;
  perfilId?: number;
  url?: string;
  login?: string;
  /** A senha é obrigatória: vazia ou ausente mantém a atual, e `null` é recusado. */
  senha?: string;
  securityToken?: string | null;
  situacao?: Situacao;
}

// --- Login ---

/** Item de GET /api/tipos-login: os valores aceitos em `PerfilDto.tipoLogin`. */
export interface TipoLoginDto {
  tipo: string;
}

/**
 * Resposta 200 de POST /api/contextos/{id}/testar-login, que ignora o cache de tokens. Exige
 * `Content-Type: application/json`, e o corpo é ignorado. Contexto ou perfil arquivado: 409.
 */
export type TesteLoginResponse = TesteLoginSucesso | TesteLoginFalha;

export interface TesteLoginSucesso {
  ok: true;
  instanceUrl: string;
  /** `null` quando o Salesforce não informa `expires_in`: o token vale até receber 401. */
  expiresAt: string | null;
  expiresAtSource: "salesforce" | "nao-informado";
  /** Resultado da chamada de validação do token. */
  testeToken: { endpoint: string; httpStatus: number };
}

export interface TesteLoginFalha {
  ok: false;
  /** `salesforce`: o servidor respondeu com erro. `rede`: sem resposta. `configuracao`: nada foi chamado. */
  kind: "salesforce" | "rede" | "configuracao";
  /** Etapa do fluxo, por exemplo `authorize`, `token` ou `userinfo`. */
  step?: string;
  httpStatus?: number;
  /** Texto real do Salesforce: só segredos são mascarados. */
  error?: string;
  /** Texto real do Salesforce: só segredos são mascarados. */
  errorDescription?: string;
  /** Corpo da resposta, mascarado e truncado. */
  rawBody?: string;
  /** Explicação da própria ferramenta, separada dos campos vindos do Salesforce. */
  message?: string;
}

// --- Situação do serviço ---

/** Resposta de GET /api/status. */
export interface StatusResponse {
  chaveCriptografia: { configurada: true } | { configurada: false; aviso: string };
}

// --- Respostas comuns ---

/** Resposta das listagens: GET /api/ambientes, /api/perfis e /api/contextos. */
export interface ListaResponse<T> {
  itens: T[];
}

export type CodigoErro =
  | "VALIDACAO" // 400: ver `campos`
  | "HOST_RECUSADO" // 403: Host ou Origin fora de localhost, 127.0.0.1 e [::1]
  | "NAO_ENCONTRADO" // 404
  | "CONFLITO" // 409: novo contexto em perfil arquivado, ou teste de login de arquivado
  | "TIPO_DE_CONTEUDO" // 415: a requisição não é application/json
  | "CHAVE_CRIPTOGRAFIA" // 503: chave ausente ou inválida; nada foi gravado
  | "INTERNO"; // 500

export interface CampoInvalido {
  /** Caminho do campo na requisição, por exemplo `app.clientId`. */
  campo: string;
  mensagem: string;
}

export interface ErroResponse {
  erro: {
    codigo: CodigoErro;
    mensagem: string;
    campos?: CampoInvalido[];
  };
}
