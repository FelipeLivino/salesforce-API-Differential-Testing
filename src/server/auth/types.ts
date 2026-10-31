export interface LoginInput {
  loginUrl: string; // contexto.url
  clientId: string;
  clientSecret?: string;
  redirectUri?: string; // exigido pelo Headless
  username: string;
  password: string; // já decifrada; só existe durante a chamada
  securityToken?: string;
  /** Outros segredos conhecidos, como o token em cache, para mascarar antes de truncar o corpo. */
  maskValues?: string[];
}

export interface LoginSuccess {
  ok: true;
  accessToken: string;
  /** URL base das chamadas seguintes: `instance_url` ou, no Headless, `sfdc_community_url`. */
  instanceUrl: string;
  issuedAt: Date;
  /** Só existe se o Salesforce informar `expires_in`. Sem ele, o token vale até receber 401. */
  expiresAt: Date | null;
  expiresAtSource: "salesforce" | "nao-informado";
  /** Valores do fluxo, como code, verificador PKCE e refresh_token, que só servem para mascarar saídas. */
  maskValues?: string[];
}

export interface LoginFailure {
  ok: false;
  kind: "salesforce" | "rede" | "configuracao";
  step?: string; // etapa do fluxo, ex.: "authorize" ou "token"
  httpStatus?: number;
  error?: string; // campo `error` do Salesforce; só segredos são mascarados
  errorDescription?: string; // campo `error_description`; só segredos são mascarados
  rawBody?: string; // corpo da resposta, mascarado e truncado
  /** Explicação da própria ferramenta, sempre separada dos campos vindos do Salesforce. */
  message?: string;
}

export type LoginResult = LoginSuccess | LoginFailure;

export interface LoginAdapter {
  readonly type: string; // ex.: "headless", "username-password"
  login(input: LoginInput, signal?: AbortSignal): Promise<LoginResult>;
}
