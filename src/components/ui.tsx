"use client";

import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import type { ErroApi } from "@/lib/api-client";

export function CaixaErro({
  erro,
  titulo = "Erro",
  aoTentarNovamente,
}: {
  erro: ErroApi;
  titulo?: string;
  aoTentarNovamente?: () => void;
}) {
  const origem = [erro.status !== undefined && `HTTP ${erro.status}`, erro.codigo].filter(Boolean).join(" · ");
  return (
    <div className="caixa caixa-erro" role="alert">
      <strong>{titulo}</strong>
      {origem && <span className="detalhe"> ({origem})</span>}
      <p className="literal">{erro.message}</p>
      {aoTentarNovamente && (
        <button type="button" onClick={aoTentarNovamente}>
          Tentar novamente
        </button>
      )}
    </div>
  );
}

export function Aviso({ texto }: { texto?: string }) {
  return (
    <div role="status" aria-live="polite">
      {texto && <p className="caixa caixa-sucesso">{texto}</p>}
    </div>
  );
}

export const Carregando = ({ texto }: { texto: string }) => (
  <p className="estado" role="status">
    {texto}
  </p>
);

export const Vazio = ({ children }: { children: ReactNode }) => <div className="estado">{children}</div>;

export const erroDoCampo = (erro: ErroApi | undefined, campo: string) =>
  erro?.campos.find((item) => item.campo === campo)?.mensagem;

export function Campo({
  rotulo,
  dica,
  erro,
  children,
}: {
  rotulo: string;
  dica?: string;
  erro?: string;
  children: ReactNode;
}) {
  return (
    <label className="campo">
      <span className="rotulo">{rotulo}</span>
      {children}
      {dica && <span className="dica">{dica}</span>}
      {erro && <span className="erro-campo">{erro}</span>}
    </label>
  );
}

/** O valor salvo nunca volta para a tela: só se está definido, com campo vazio para substituir. */
export function CampoSegredo({
  rotulo,
  valor,
  aoMudar,
  definido,
  dica,
  erro,
  remover,
  aoMudarRemover,
}: {
  rotulo: string;
  valor: string;
  aoMudar: (valor: string) => void;
  /** Ausente na criação, quando ainda não há valor salvo. */
  definido?: boolean;
  dica?: string;
  erro?: string;
  /** Só para segredo opcional já definido. */
  remover?: boolean;
  aoMudarRemover?: (remover: boolean) => void;
}) {
  const editando = definido !== undefined;
  const situacao = editando ? (definido ? "valor definido" : "sem valor definido") : undefined;
  const dicaEdicao = editando ? (definido ? "Deixe vazio para manter o valor atual." : "Deixe vazio para continuar sem valor.") : undefined;
  return (
    <div>
      <Campo rotulo={situacao ? `${rotulo}: ${situacao}` : rotulo} dica={[dicaEdicao, dica].filter(Boolean).join(" ")} erro={erro}>
        <input
          type="password"
          value={remover ? "" : valor}
          disabled={remover}
          autoComplete="new-password"
          spellCheck={false}
          onChange={(evento) => aoMudar(evento.target.value)}
        />
      </Campo>
      {definido && aoMudarRemover && (
        <label className="marcador">
          <input type="checkbox" checked={remover ?? false} onChange={(evento) => aoMudarRemover(evento.target.checked)} />
          Remover o valor salvo
        </label>
      )}
    </div>
  );
}

export function Formulario({
  titulo,
  erro,
  enviando,
  aoEnviar,
  aoCancelar,
  children,
}: {
  titulo: string;
  erro?: ErroApi;
  enviando: boolean;
  aoEnviar: () => void;
  aoCancelar: () => void;
  children: ReactNode;
}) {
  const painel = useRef<HTMLFormElement>(null);
  useEffect(() => {
    painel.current?.scrollIntoView({ block: "nearest" });
  }, []);

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (!enviando) aoEnviar();
  }

  // Sem validação do navegador: quem valida e explica é a rota.
  return (
    <form ref={painel} className="painel" onSubmit={enviar} noValidate autoComplete="off">
      <h2>{titulo}</h2>
      {erro && <CaixaErro erro={erro} titulo="Não foi possível salvar" />}
      {children}
      <div className="acoes">
        <button type="submit" className="primario" disabled={enviando} aria-busy={enviando}>
          {enviando ? "Salvando..." : "Salvar"}
        </button>
        <button type="button" onClick={aoCancelar} disabled={enviando}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export const Selo = ({ arquivado, children }: { arquivado?: boolean; children: ReactNode }) => (
  <span className={arquivado ? "selo selo-arquivado" : "selo"}>{children}</span>
);

export const Item = ({ termo, children }: { termo: string; children: ReactNode }) => (
  <div>
    <dt>{termo}</dt>
    <dd>{children}</dd>
  </div>
);
