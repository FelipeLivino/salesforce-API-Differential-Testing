import type { Situacao } from "@/shared/dto";
import type { Db } from "../connection";

const AGORA = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export interface ContextoRecord {
  id: number;
  ambienteId: number;
  perfilId: number;
  url: string;
  login: string;
  senhaCifrada: string;
  securityTokenCifrado: string | null;
  situacao: Situacao;
  criadoEm: string;
  atualizadoEm: string;
}

export interface NovoContexto {
  ambienteId: number;
  perfilId: number;
  url: string;
  login: string;
  senhaCifrada: string;
  securityTokenCifrado: string | null;
}

/** Campo `undefined` mantém o valor atual. */
export type AlteracaoContexto = Partial<NovoContexto> & { situacao?: Situacao };

interface Linha {
  id: number;
  ambiente_id: number;
  perfil_id: number;
  url: string;
  login: string;
  senha_cifrada: string;
  security_token_cifrado: string | null;
  situacao: Situacao;
  criado_em: string;
  atualizado_em: string;
}

function paraRecord(linha: Linha): ContextoRecord {
  return {
    id: linha.id,
    ambienteId: linha.ambiente_id,
    perfilId: linha.perfil_id,
    url: linha.url,
    login: linha.login,
    senhaCifrada: linha.senha_cifrada,
    securityTokenCifrado: linha.security_token_cifrado,
    situacao: linha.situacao,
    criadoEm: linha.criado_em,
    atualizadoEm: linha.atualizado_em,
  };
}

export type ContextosRepository = ReturnType<typeof createContextosRepository>;

/** Guarda segredos só como recebidos: quem chama entrega o valor já cifrado. */
export function createContextosRepository(db: Db) {
  function listar(): ContextoRecord[] {
    return (db.prepare("SELECT * FROM contextos ORDER BY id").all() as Linha[]).map(paraRecord);
  }

  function buscarPorId(id: number): ContextoRecord | undefined {
    const linha = db.prepare("SELECT * FROM contextos WHERE id = ?").get(id) as Linha | undefined;
    return linha && paraRecord(linha);
  }

  function criar(novo: NovoContexto): ContextoRecord {
    const id = db
      .prepare(
        `INSERT INTO contextos (ambiente_id, perfil_id, url, login, senha_cifrada, security_token_cifrado)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(novo.ambienteId, novo.perfilId, novo.url, novo.login, novo.senhaCifrada, novo.securityTokenCifrado)
      .lastInsertRowid;
    return buscarPorId(Number(id))!;
  }

  const atualizar = db.transaction((id: number, alteracao: AlteracaoContexto): ContextoRecord | undefined => {
    const atual = buscarPorId(id);
    if (!atual) return undefined;
    db.prepare(
      `UPDATE contextos
       SET ambiente_id = ?, perfil_id = ?, url = ?, login = ?, senha_cifrada = ?,
           security_token_cifrado = ?, situacao = ?, atualizado_em = ${AGORA}
       WHERE id = ?`,
    ).run(
      alteracao.ambienteId ?? atual.ambienteId,
      alteracao.perfilId ?? atual.perfilId,
      alteracao.url ?? atual.url,
      alteracao.login ?? atual.login,
      alteracao.senhaCifrada ?? atual.senhaCifrada,
      alteracao.securityTokenCifrado === undefined ? atual.securityTokenCifrado : alteracao.securityTokenCifrado,
      alteracao.situacao ?? atual.situacao,
      id,
    );
    return buscarPorId(id);
  });

  return { listar, buscarPorId, criar, atualizar };
}
