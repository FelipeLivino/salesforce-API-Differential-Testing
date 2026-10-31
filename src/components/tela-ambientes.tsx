"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { useAcao, useRecurso } from "@/lib/hooks";
import { TIPOS_AMBIENTE, type AmbienteDto, type TipoAmbiente } from "@/shared/dto";
import { Aviso, CaixaErro, Campo, CampoSegredo, Carregando, erroDoCampo, Formulario, Item, Selo, Vazio } from "./ui";

export const ROTULO_TIPO_AMBIENTE: Record<TipoAmbiente, string> = { sandbox: "Sandbox", producao: "Produção" };

function FormularioAmbiente({
  ambiente,
  aoSalvar,
  aoCancelar,
}: {
  ambiente?: AmbienteDto;
  aoSalvar: () => void;
  aoCancelar: () => void;
}) {
  const [url, setUrl] = useState(ambiente?.url ?? "");
  const [tipo, setTipo] = useState<string>(ambiente?.tipo ?? "");
  const [clientId, setClientId] = useState(ambiente?.app.clientId ?? "");
  const [redirectUri, setRedirectUri] = useState(ambiente?.app.redirectUri ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [removerSecret, setRemoverSecret] = useState(false);
  const { executando, erro, executar } = useAcao();

  async function salvar() {
    const app = { clientId, redirectUri };
    const ok = await executar(() => {
      if (!ambiente) {
        return api.ambientes.criar({ url, tipo: tipo as TipoAmbiente, app: { ...app, clientSecret } });
      }
      const secret = removerSecret ? { clientSecret: null } : clientSecret.trim() ? { clientSecret } : {};
      return api.ambientes.editar(ambiente.id, { url, tipo: tipo as TipoAmbiente, app: { ...app, ...secret } });
    });
    if (ok) aoSalvar();
  }

  return (
    <Formulario
      titulo={ambiente ? "Editar ambiente" : "Novo ambiente"}
      erro={erro}
      enviando={executando}
      aoEnviar={salvar}
      aoCancelar={aoCancelar}
    >
      <Campo rotulo="URL" erro={erroDoCampo(erro, "url")}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="off" spellCheck={false} />
      </Campo>
      <Campo rotulo="Tipo" erro={erroDoCampo(erro, "tipo")}>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="">Selecione</option>
          {TIPOS_AMBIENTE.map((valor) => (
            <option key={valor} value={valor}>
              {ROTULO_TIPO_AMBIENTE[valor]}
            </option>
          ))}
        </select>
      </Campo>
      <fieldset>
        <legend>App OAuth</legend>
        <Campo rotulo="Client ID" erro={erroDoCampo(erro, "app.clientId")}>
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} />
        </Campo>
        <CampoSegredo
          rotulo="Client Secret (opcional)"
          valor={clientSecret}
          aoMudar={setClientSecret}
          definido={ambiente?.app.clientSecretDefinido}
          erro={erroDoCampo(erro, "app.clientSecret")}
          remover={removerSecret}
          aoMudarRemover={setRemoverSecret}
        />
        <Campo
          rotulo="Redirect URI (opcional)"
          dica="Exigida pelo login Headless. Precisa ser igual à cadastrada no app."
          erro={erroDoCampo(erro, "app.redirectUri")}
        >
          <input value={redirectUri} onChange={(e) => setRedirectUri(e.target.value)} autoComplete="off" spellCheck={false} />
        </Campo>
      </fieldset>
    </Formulario>
  );
}

export function TelaAmbientes() {
  const ambientes = useRecurso(api.ambientes.listar);
  const [edicao, setEdicao] = useState<AmbienteDto | "novo">();
  const [aviso, setAviso] = useState<string>();

  function abrir(alvo: AmbienteDto | "novo") {
    setAviso(undefined);
    setEdicao(alvo);
  }

  return (
    <main>
      <div className="cabecalho">
        <div>
          <h1>Ambientes</h1>
          <p className="detalhe">Ambientes não são arquivados nem excluídos nesta fase.</p>
        </div>
        <button type="button" className="primario" onClick={() => abrir("novo")}>
          Novo ambiente
        </button>
      </div>
      <Aviso texto={aviso} />
      {edicao && (
        <FormularioAmbiente
          key={edicao === "novo" ? "novo" : edicao.id}
          ambiente={edicao === "novo" ? undefined : edicao}
          aoCancelar={() => setEdicao(undefined)}
          aoSalvar={() => {
            setEdicao(undefined);
            setAviso("Ambiente salvo.");
            void ambientes.recarregar();
          }}
        />
      )}
      {ambientes.erro && (
        <CaixaErro erro={ambientes.erro} titulo="Não foi possível carregar os ambientes" aoTentarNovamente={ambientes.recarregar} />
      )}
      {!ambientes.dados && ambientes.carregando && <Carregando texto="Carregando ambientes..." />}
      {ambientes.dados?.length === 0 && (
        <Vazio>
          <p>Nenhum ambiente cadastrado.</p>
        </Vazio>
      )}
      <ul className="lista">
        {ambientes.dados?.map((ambiente) => (
          <li key={ambiente.id} className="cartao">
            <div className="cartao-topo">
              <strong className="quebra">{ambiente.url}</strong>
              <Selo>{ROTULO_TIPO_AMBIENTE[ambiente.tipo]}</Selo>
            </div>
            <dl>
              <Item termo="Client ID">
                <span className="quebra">{ambiente.app.clientId}</span>
              </Item>
              <Item termo="Client Secret">{ambiente.app.clientSecretDefinido ? "Definido" : "Não definido"}</Item>
              <Item termo="Redirect URI">
                <span className="quebra">{ambiente.app.redirectUri ?? "Não definida"}</span>
              </Item>
            </dl>
            <div className="acoes">
              <button type="button" onClick={() => abrir(ambiente)}>
                Editar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
