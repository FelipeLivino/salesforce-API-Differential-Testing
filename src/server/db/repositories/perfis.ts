import type { Situacao } from "@/shared/dto";
import type { Db } from "../connection";

const AGORA = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export interface PerfilRecord {
  id: number;
  nome: string;
  descricao: string | null;
  tipoLogin: string;
  situacao: Situacao;
  possuiContextos: boolean;
  criadoEm: string;
  atualizadoEm: string;
}

export interface NovoPerfil {
  nome: string;
  descricao: string | null;
  tipoLogin: string;
  situacao: Situacao;
}

/** Campo `undefined` mantém o valor atual. */
export type AlteracaoPerfil = Partial<NovoPerfil>;

export type ResultadoRemocaoPerfil = "excluido" | "arquivado";

interface Linha {
  id: number;
  nome: string;
  descricao: string | null;
  tipo_login: string;
  situacao: Situacao;
  possui_contextos: number;
  criado_em: string;
  atualizado_em: string;
}

const SELECT = `
  SELECT p.id, p.nome, p.descricao, p.tipo_login, p.situacao, p.criado_em, p.atualizado_em,
         EXISTS (SELECT 1 FROM contextos c WHERE c.perfil_id = p.id) AS possui_contextos
  FROM perfis p`;

function paraRecord(linha: Linha): PerfilRecord {
  return {
    id: linha.id,
    nome: linha.nome,
    descricao: linha.descricao,
    tipoLogin: linha.tipo_login,
    situacao: linha.situacao,
    possuiContextos: linha.possui_contextos === 1,
    criadoEm: linha.criado_em,
    atualizadoEm: linha.atualizado_em,
  };
}

export type PerfisRepository = ReturnType<typeof createPerfisRepository>;

export function createPerfisRepository(db: Db) {
  function listar(): PerfilRecord[] {
    return (db.prepare(`${SELECT} ORDER BY p.id`).all() as Linha[]).map(paraRecord);
  }

  function buscarPorId(id: number): PerfilRecord | undefined {
    const linha = db.prepare(`${SELECT} WHERE p.id = ?`).get(id) as Linha | undefined;
    return linha && paraRecord(linha);
  }

  function criar(novo: NovoPerfil): PerfilRecord {
    const id = db
      .prepare("INSERT INTO perfis (nome, descricao, tipo_login, situacao) VALUES (?, ?, ?, ?)")
      .run(novo.nome, novo.descricao, novo.tipoLogin, novo.situacao).lastInsertRowid;
    return buscarPorId(Number(id))!;
  }

  const atualizar = db.transaction((id: number, alteracao: AlteracaoPerfil): PerfilRecord | undefined => {
    const atual = buscarPorId(id);
    if (!atual) return undefined;
    db.prepare(
      `UPDATE perfis SET nome = ?, descricao = ?, tipo_login = ?, situacao = ?, atualizado_em = ${AGORA} WHERE id = ?`,
    ).run(
      alteracao.nome ?? atual.nome,
      alteracao.descricao === undefined ? atual.descricao : alteracao.descricao,
      alteracao.tipoLogin ?? atual.tipoLogin,
      alteracao.situacao ?? atual.situacao,
      id,
    );
    return buscarPorId(id);
  });

  /** Com contexto vinculado, ativo ou arquivado, o perfil é arquivado. Sem nenhum, é excluído. */
  const excluirOuArquivar = db.transaction((id: number): ResultadoRemocaoPerfil | undefined => {
    const atual = buscarPorId(id);
    if (!atual) return undefined;
    if (atual.possuiContextos) {
      db.prepare(`UPDATE perfis SET situacao = 'arquivado', atualizado_em = ${AGORA} WHERE id = ?`).run(id);
      return "arquivado";
    }
    db.prepare("DELETE FROM perfis WHERE id = ?").run(id);
    return "excluido";
  });

  return { listar, buscarPorId, criar, atualizar, excluirOuArquivar };
}
