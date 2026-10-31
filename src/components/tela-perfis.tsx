"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { useAcao, useRecurso } from "@/lib/hooks";
import type { PerfilDto, Situacao, TipoLoginDto } from "@/shared/dto";
import { Aviso, CaixaErro, Campo, Carregando, erroDoCampo, Formulario, Item, Selo, Vazio } from "./ui";

function FormularioPerfil({
  perfil,
  tipos,
  aoSalvar,
  aoCancelar,
}: {
  perfil?: PerfilDto;
  tipos: TipoLoginDto[];
  aoSalvar: () => void;
  aoCancelar: () => void;
}) {
  const [nome, setNome] = useState(perfil?.nome ?? "");
  const [descricao, setDescricao] = useState(perfil?.descricao ?? "");
  const [tipoLogin, setTipoLogin] = useState(perfil?.tipoLogin ?? "");
  const [situacao, setSituacao] = useState<Situacao>(perfil?.situacao ?? "ativo");
  const { executando, erro, executar } = useAcao();

  // Perfil antigo pode ter um tipo que já não tem adaptador: ele continua visível (decisão C14).
  const semAdaptador = perfil && !tipos.some(({ tipo }) => tipo === perfil.tipoLogin) ? perfil.tipoLogin : undefined;

  async function salvar() {
    const dados = { nome, descricao, tipoLogin, situacao };
    const ok = await executar(() => (perfil ? api.perfis.editar(perfil.id, dados) : api.perfis.criar(dados)));
    if (ok) aoSalvar();
  }

  return (
    <Formulario
      titulo={perfil ? "Editar perfil" : "Novo perfil"}
      erro={erro}
      enviando={executando}
      aoEnviar={salvar}
      aoCancelar={aoCancelar}
    >
      <Campo rotulo="Nome" erro={erroDoCampo(erro, "nome")}>
        <input value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="off" />
      </Campo>
      <Campo rotulo="Descrição (opcional)" erro={erroDoCampo(erro, "descricao")}>
        <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2} />
      </Campo>
      <Campo rotulo="Tipo de login" erro={erroDoCampo(erro, "tipoLogin")}>
        <select value={tipoLogin} onChange={(e) => setTipoLogin(e.target.value)}>
          <option value="">Selecione</option>
          {tipos.map(({ tipo }) => (
            <option key={tipo} value={tipo}>
              {tipo}
            </option>
          ))}
          {semAdaptador && <option value={semAdaptador}>{semAdaptador} (sem adaptador registrado)</option>}
        </select>
      </Campo>
      <Campo rotulo="Situação" erro={erroDoCampo(erro, "situacao")}>
        <select value={situacao} onChange={(e) => setSituacao(e.target.value as Situacao)}>
          <option value="ativo">Ativo</option>
          <option value="arquivado">Arquivado</option>
        </select>
      </Campo>
    </Formulario>
  );
}

function CartaoPerfil({
  perfil,
  aoEditar,
  aoMudar,
}: {
  perfil: PerfilDto;
  aoEditar: () => void;
  aoMudar: (aviso: string) => void;
}) {
  const { executando, erro, executar } = useAcao();
  const [confirmando, setConfirmando] = useState(false);
  const arquivado = perfil.situacao === "arquivado";

  async function mudarSituacao() {
    const situacao: Situacao = arquivado ? "ativo" : "arquivado";
    if (await executar(() => api.perfis.editar(perfil.id, { situacao }))) {
      aoMudar(arquivado ? "Perfil reativado." : "Perfil arquivado.");
    }
  }

  async function excluir() {
    setConfirmando(false);
    let texto = "";
    const ok = await executar(async () => {
      const { resultado } = await api.perfis.remover(perfil.id);
      texto = resultado === "excluido" ? "Perfil excluído." : "O perfil tem contextos vinculados e foi arquivado.";
    });
    if (ok) aoMudar(texto);
  }

  return (
    <li className="cartao">
      <div className="cartao-topo">
        <strong className="quebra">{perfil.nome}</strong>
        <Selo arquivado={arquivado}>{arquivado ? "Arquivado" : "Ativo"}</Selo>
      </div>
      <dl>
        <Item termo="Tipo de login">{perfil.tipoLogin}</Item>
        <Item termo="Descrição">{perfil.descricao ?? "Sem descrição"}</Item>
        <Item termo="Contextos vinculados">{perfil.possuiContextos ? "Sim" : "Não"}</Item>
      </dl>
      {erro && <CaixaErro erro={erro} titulo="Não foi possível concluir a ação" />}
      <div className="acoes">
        <button type="button" onClick={aoEditar} disabled={executando}>
          Editar
        </button>
        <button type="button" onClick={mudarSituacao} disabled={executando}>
          {arquivado ? "Reativar" : "Arquivar"}
        </button>
        {!perfil.possuiContextos &&
          (confirmando ? (
            <>
              <button type="button" className="perigo" onClick={excluir} disabled={executando}>
                Confirmar exclusão
              </button>
              <button type="button" onClick={() => setConfirmando(false)}>
                Não excluir
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmando(true)} disabled={executando}>
              Excluir
            </button>
          ))}
      </div>
    </li>
  );
}

export function TelaPerfis() {
  const perfis = useRecurso(api.perfis.listar);
  const tipos = useRecurso(api.tiposLogin.listar);
  const [edicao, setEdicao] = useState<PerfilDto | "novo">();
  const [aviso, setAviso] = useState<string>();

  function abrir(alvo: PerfilDto | "novo") {
    setAviso(undefined);
    setEdicao(alvo);
  }

  function concluir(texto: string) {
    setEdicao(undefined);
    setAviso(texto);
    void perfis.recarregar();
  }

  return (
    <main>
      <div className="cabecalho">
        <div>
          <h1>Perfis</h1>
          <p className="detalhe">Perfil com contexto vinculado não pode ser excluído, apenas arquivado.</p>
        </div>
        <button type="button" className="primario" onClick={() => abrir("novo")} disabled={!tipos.dados?.length}>
          Novo perfil
        </button>
      </div>
      <Aviso texto={aviso} />
      {tipos.erro && (
        <CaixaErro erro={tipos.erro} titulo="Não foi possível carregar os tipos de login" aoTentarNovamente={tipos.recarregar} />
      )}
      {tipos.dados?.length === 0 && <p className="caixa caixa-erro">Nenhum tipo de login registrado.</p>}
      {edicao && (
        <FormularioPerfil
          key={edicao === "novo" ? "novo" : edicao.id}
          perfil={edicao === "novo" ? undefined : edicao}
          tipos={tipos.dados ?? []}
          aoCancelar={() => setEdicao(undefined)}
          aoSalvar={() => concluir("Perfil salvo.")}
        />
      )}
      {perfis.erro && (
        <CaixaErro erro={perfis.erro} titulo="Não foi possível carregar os perfis" aoTentarNovamente={perfis.recarregar} />
      )}
      {!perfis.dados && perfis.carregando && <Carregando texto="Carregando perfis..." />}
      {perfis.dados?.length === 0 && (
        <Vazio>
          <p>Nenhum perfil cadastrado.</p>
        </Vazio>
      )}
      <ul className="lista">
        {perfis.dados?.map((perfil) => (
          <CartaoPerfil key={perfil.id} perfil={perfil} aoEditar={() => abrir(perfil)} aoMudar={concluir} />
        ))}
      </ul>
    </main>
  );
}
