import type { TesteLoginFalha, TesteLoginSucesso } from "@/shared/dto";
import { Item } from "./ui";

const TITULO_FALHA: Record<TesteLoginFalha["kind"], string> = {
  salesforce: "Login não concluído: falha na resposta do Salesforce",
  rede: "Erro de conexão: sem resposta válida do Salesforce",
  configuracao: "Erro de configuração: nenhuma chamada foi feita",
};

export function SucessoTesteLogin({ resultado }: { resultado: TesteLoginSucesso }) {
  return (
    <div className="caixa caixa-sucesso">
      <strong>Login aceito</strong>
      <dl>
        <Item termo="Instância">
          <span className="quebra">{resultado.instanceUrl}</span>
        </Item>
        <Item termo="Validade do token">
          {resultado.expiresAt
            ? new Date(resultado.expiresAt).toLocaleString("pt-BR")
            : "Não informada: o token vale até receber 401"}
        </Item>
        <Item termo="Teste do token">
          <span className="quebra">
            {resultado.testeToken.endpoint}: HTTP {resultado.testeToken.httpStatus}
          </span>
        </Item>
      </dl>
    </div>
  );
}

/** Mostra os campos como vieram, sem traduzir nem substituir por mensagem pronta (decisão 3). */
export function FalhaTesteLogin({ resultado }: { resultado: TesteLoginFalha }) {
  const { kind, step, httpStatus, error, errorDescription, rawBody, message } = resultado;
  return (
    <div className="caixa caixa-erro">
      <strong>{TITULO_FALHA[kind]}</strong>
      <dl>
        {step !== undefined && <Item termo="Etapa">{step}</Item>}
        {httpStatus !== undefined && <Item termo="Status HTTP">{httpStatus}</Item>}
        {error !== undefined && (
          <Item termo="error">
            <span className="literal">{error}</span>
          </Item>
        )}
        {errorDescription !== undefined && (
          <Item termo="error_description">
            <span className="literal">{errorDescription}</span>
          </Item>
        )}
        {message !== undefined && (
          <Item termo="Mensagem da ferramenta">
            <span className="literal">{message}</span>
          </Item>
        )}
      </dl>
      {rawBody !== undefined && (
        <details>
          <summary>Corpo da resposta</summary>
          <pre>{rawBody}</pre>
        </details>
      )}
    </div>
  );
}
