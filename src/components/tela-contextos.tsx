"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ErroApi, paraErroApi } from "@/lib/api-client";
import { useAcao, useRecurso } from "@/lib/hooks";
import type { AmbienteDto, ContextoDto, PerfilDto, TesteLoginResponse } from "@/shared/dto";
import { FalhaTesteLogin, SucessoTesteLogin } from "./resultado-teste-login";
import { ROTULO_TIPO_AMBIENTE } from "./tela-ambientes";
import { Aviso, CaixaErro, Campo, CampoSegredo, Carregando, erroDoCampo, Formulario, Item, Selo, Vazio } from "./ui";

const rotuloAmbiente = (ambiente: AmbienteDto) => `${ambiente.url} (${ROTULO_TIPO_AMBIENTE[ambiente.tipo]})`;

function FormularioContexto({
  contexto,
  ambientes,
  perfis,
  aoSalvar,
  aoCancelar,
}: {
  contexto?: ContextoDto;
  ambientes: AmbienteDto[];
  perfis: PerfilDto[];
  aoSalvar: () => void;
  aoCancelar: () => void;
}) {
  const [ambienteId, setAmbienteId] = useState(contexto ? String(contexto.ambienteId) : "");
  const [perfilId, setPerfilId] = useState(contexto ? String(contexto.perfilId) : "");
  const [url, setUrl] = useState(contexto?.url ?? "");
  const [login, setLogin] = useState(contexto?.login ?? "");
  const [senha, setSenha] = useState("");
  const [securityToken, setSecurityToken] = useState("");
  const [removerToken, setRemoverToken] = useState(false);
  const { executando, erro, executar } = useAcao();

  // Perfil arquivado não recebe contexto novo, mas o contexto que já o usa continua mostrando-o.
  const opcoesPerfil = perfis.filter((perfil) => perfil.situacao === "ativo" || perfil.id === contexto?.perfilId);

  async function salvar() {
    // Sem seleção, o campo não vai: a rota recusa a criação indicando-o. A edição não oferece opção vazia.
    const ids = {
      ambienteId: (Number(ambienteId) || undefined) as number,
      perfilId: (Number(perfilId) || undefined) as number,
    };
    const ok = await executar(() => {
      if (!contexto) return api.contextos.criar({ ...ids, url, login, senha, securityToken });
      return api.contextos.editar(contexto.id, {
        ...ids,
        url,
        login,
        ...(senha.trim() && { senha }),
        ...(removerToken ? { securityToken: null } : securityToken.trim() ? { securityToken } : {}),
      });
    });
    if (ok) aoSalvar();
  }

  return (
    <Formulario
      titulo={contexto ? "Editar contexto" : "Novo contexto"}
      erro={erro}
      enviando={executando}
      aoEnviar={salvar}
      aoCancelar={aoCancelar}
    >
      <Campo rotulo="Ambiente" erro={erroDoCampo(erro, "ambienteId")}>
        <select value={ambienteId} onChange={(e) => setAmbienteId(e.target.value)}>
          {!contexto && <option value="">Selecione</option>}
          {ambientes.map((ambiente) => (
            <option key={ambiente.id} value={ambiente.id}>
              {rotuloAmbiente(ambiente)}
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Perfil" erro={erroDoCampo(erro, "perfilId")}>
        <select value={perfilId} onChange={(e) => setPerfilId(e.target.value)}>
          {!contexto && <option value="">Selecione</option>}
          {opcoesPerfil.map((perfil) => (
            <option key={perfil.id} value={perfil.id}>
              {perfil.nome} ({perfil.tipoLogin}){perfil.situacao === "arquivado" ? " (arquivado)" : ""}
            </option>
          ))}
        </select>
      </Campo>
      <Campo
        rotulo="URL"
        dica="URL do site para usuário de comunidade. URL do ambiente para usuário de integração."
        erro={erroDoCampo(erro, "url")}
      >
        <input value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="off" spellCheck={false} />
      </Campo>
      <Campo rotulo="Login" erro={erroDoCampo(erro, "login")}>
        <input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" spellCheck={false} />
      </Campo>
      <CampoSegredo
        rotulo="Senha"
        valor={senha}
        aoMudar={setSenha}
        definido={contexto?.senhaDefinida}
        erro={erroDoCampo(erro, "senha")}
      />
      <CampoSegredo
        rotulo="Security token (opcional)"
        valor={securityToken}
        aoMudar={setSecurityToken}
        definido={contexto?.securityTokenDefinido}
        erro={erroDoCampo(erro, "securityToken")}
        remover={removerToken}
        aoMudarRemover={setRemoverToken}
      />
    </Formulario>
  );
}

function CartaoContexto({
  contexto,
  ambiente,
  perfil,
  aoEditar,
  aoMudar,
}: {
  contexto: ContextoDto;
  ambiente?: AmbienteDto;
  perfil?: PerfilDto;
  aoEditar: () => void;
  aoMudar: (aviso: string) => void;
}) {
  const { executando, erro, executar } = useAcao();
  const [testando, setTestando] = useState(false);
  const [resultado, setResultado] = useState<TesteLoginResponse>();
  const [erroTeste, setErroTeste] = useState<ErroApi>();

  const arquivado = contexto.situacao === "arquivado";
  const perfilArquivado = perfil?.situacao === "arquivado";
  const motivoBloqueio = arquivado
    ? "Contexto arquivado não pode ser testado."
    : perfilArquivado
      ? "Contexto de perfil arquivado não pode ser testado."
      : undefined;

  async function testar() {
    setTestando(true);
    setResultado(undefined);
    setErroTeste(undefined);
    try {
      setResultado(await api.contextos.testarLogin(contexto.id));
    } catch (e) {
      setErroTeste(paraErroApi(e));
    } finally {
      setTestando(false);
    }
  }

  async function mudarSituacao() {
    const situacao = arquivado ? "ativo" : "arquivado";
    if (await executar(() => api.contextos.editar(contexto.id, { situacao }))) {
      aoMudar(arquivado ? "Contexto reativado." : "Contexto arquivado.");
    }
  }

  return (
    <li className="cartao">
      <div className="cartao-topo">
        <strong className="quebra">{contexto.login}</strong>
        <Selo arquivado={arquivado}>{arquivado ? "Arquivado" : "Ativo"}</Selo>
      </div>
      <dl>
        <Item termo="Perfil">
          {perfil ? `${perfil.nome} (${perfil.tipoLogin})${perfilArquivado ? " (arquivado)" : ""}` : `Perfil ${contexto.perfilId}`}
        </Item>
        <Item termo="Ambiente">
          <span className="quebra">{ambiente ? rotuloAmbiente(ambiente) : `Ambiente ${contexto.ambienteId}`}</span>
        </Item>
        <Item termo="URL">
          <span className="quebra">{contexto.url}</span>
        </Item>
        <Item termo="Senha">{contexto.senhaDefinida ? "Definida" : "Não definida"}</Item>
        <Item termo="Security token">{contexto.securityTokenDefinido ? "Definido" : "Não definido"}</Item>
      </dl>
      {erro && <CaixaErro erro={erro} titulo="Não foi possível concluir a ação" />}
      <div className="acoes">
        <button
          type="button"
          className="primario"
          onClick={testar}
          disabled={testando || motivoBloqueio !== undefined}
          aria-busy={testando}
        >
          {testando ? "Testando login..." : "Testar login"}
        </button>
        <button type="button" onClick={aoEditar} disabled={executando}>
          Editar
        </button>
        <button type="button" onClick={mudarSituacao} disabled={executando}>
          {arquivado ? "Reativar" : "Arquivar"}
        </button>
      </div>
      {motivoBloqueio && <p className="detalhe">{motivoBloqueio}</p>}
      <div role="status" aria-live="polite">
        {resultado?.ok === true && <SucessoTesteLogin resultado={resultado} />}
        {resultado?.ok === false && <FalhaTesteLogin resultado={resultado} />}
        {erroTeste && <CaixaErro erro={erroTeste} titulo="Não foi possível testar o login" />}
      </div>
    </li>
  );
}

export function TelaContextos() {
  const contextos = useRecurso(api.contextos.listar);
  const ambientes = useRecurso(api.ambientes.listar);
  const perfis = useRecurso(api.perfis.listar);
  const [edicao, setEdicao] = useState<ContextoDto | "novo">();
  const [aviso, setAviso] = useState<string>();
  // Muda a chave do cartão ao alterar o contexto: um resultado de teste antigo não vale mais.
  const [versoes, setVersoes] = useState<Record<number, number>>({});

  const semAmbiente = ambientes.dados?.length === 0;
  const semPerfilAtivo = perfis.dados !== undefined && !perfis.dados.some((perfil) => perfil.situacao === "ativo");
  const podeCriar = Boolean(ambientes.dados?.length) && perfis.dados?.some((perfil) => perfil.situacao === "ativo");

  function abrir(alvo: ContextoDto | "novo") {
    setAviso(undefined);
    setEdicao(alvo);
  }

  function concluir(texto: string, id?: number) {
    setEdicao(undefined);
    setAviso(texto);
    if (id !== undefined) setVersoes((atual) => ({ ...atual, [id]: (atual[id] ?? 0) + 1 }));
    void contextos.recarregar();
    void perfis.recarregar();
  }

  return (
    <main>
      <div className="cabecalho">
        <div>
          <h1>Contextos</h1>
          <p className="detalhe">Cada contexto liga um perfil a um ambiente, com as credenciais do usuário.</p>
        </div>
        <button type="button" className="primario" onClick={() => abrir("novo")} disabled={!podeCriar}>
          Novo contexto
        </button>
      </div>
      <Aviso texto={aviso} />
      {semAmbiente && (
        <p className="caixa">
          Para criar um contexto, cadastre antes um <Link href="/ambientes">ambiente</Link>.
        </p>
      )}
      {semPerfilAtivo && (
        <p className="caixa">
          Para criar um contexto, é preciso ter um <Link href="/perfis">perfil</Link> ativo.
        </p>
      )}
      {ambientes.erro && (
        <CaixaErro erro={ambientes.erro} titulo="Não foi possível carregar os ambientes" aoTentarNovamente={ambientes.recarregar} />
      )}
      {perfis.erro && (
        <CaixaErro erro={perfis.erro} titulo="Não foi possível carregar os perfis" aoTentarNovamente={perfis.recarregar} />
      )}
      {edicao && (
        <FormularioContexto
          key={edicao === "novo" ? "novo" : edicao.id}
          contexto={edicao === "novo" ? undefined : edicao}
          ambientes={ambientes.dados ?? []}
          perfis={perfis.dados ?? []}
          aoCancelar={() => setEdicao(undefined)}
          aoSalvar={() => concluir("Contexto salvo.", edicao === "novo" ? undefined : edicao.id)}
        />
      )}
      {contextos.erro && (
        <CaixaErro erro={contextos.erro} titulo="Não foi possível carregar os contextos" aoTentarNovamente={contextos.recarregar} />
      )}
      {!contextos.dados && contextos.carregando && <Carregando texto="Carregando contextos..." />}
      {contextos.dados?.length === 0 && (
        <Vazio>
          <p>Nenhum contexto cadastrado.</p>
        </Vazio>
      )}
      <ul className="lista">
        {contextos.dados?.map((contexto) => (
          <CartaoContexto
            key={`${contexto.id}-${versoes[contexto.id] ?? 0}`}
            contexto={contexto}
            ambiente={ambientes.dados?.find((ambiente) => ambiente.id === contexto.ambienteId)}
            perfil={perfis.dados?.find((perfil) => perfil.id === contexto.perfilId)}
            aoEditar={() => abrir(contexto)}
            aoMudar={(texto) => concluir(texto, contexto.id)}
          />
        ))}
      </ul>
    </main>
  );
}
