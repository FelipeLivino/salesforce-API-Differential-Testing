import type { TipoAmbiente } from "@/shared/dto";
import type { Db } from "../connection";

const AGORA = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export interface AppOAuthRecord {
  id: number;
  clientId: string;
  clientSecretCifrado: string | null;
  redirectUri: string | null;
}

export interface AmbienteRecord {
  id: number;
  url: string;
  tipo: TipoAmbiente;
  app: AppOAuthRecord;
  criadoEm: string;
  atualizadoEm: string;
}

export interface NovoAmbiente {
  url: string;
  tipo: TipoAmbiente;
  app: Omit<AppOAuthRecord, "id">;
}

/** Campo `undefined` mantém o valor atual. */
export interface AlteracaoAmbiente {
  url?: string;
  tipo?: TipoAmbiente;
  app?: Partial<Omit<AppOAuthRecord, "id">>;
}

interface Linha {
  id: number;
  url: string;
  tipo: TipoAmbiente;
  criado_em: string;
  atualizado_em: string;
  app_id: number;
  client_id: string;
  client_secret_cifrado: string | null;
  redirect_uri: string | null;
}

const SELECT = `
  SELECT a.id, a.url, a.tipo, a.criado_em, a.atualizado_em,
         o.id AS app_id, o.client_id, o.client_secret_cifrado, o.redirect_uri
  FROM ambientes a
  JOIN apps_oauth o ON o.id = a.app_oauth_id`;

function paraRecord(linha: Linha): AmbienteRecord {
  return {
    id: linha.id,
    url: linha.url,
    tipo: linha.tipo,
    app: {
      id: linha.app_id,
      clientId: linha.client_id,
      clientSecretCifrado: linha.client_secret_cifrado,
      redirectUri: linha.redirect_uri,
    },
    criadoEm: linha.criado_em,
    atualizadoEm: linha.atualizado_em,
  };
}

export type AmbientesRepository = ReturnType<typeof createAmbientesRepository>;

/** Guarda segredos só como recebidos: quem chama entrega o valor já cifrado. */
export function createAmbientesRepository(db: Db) {
  function listar(): AmbienteRecord[] {
    return (db.prepare(`${SELECT} ORDER BY a.id`).all() as Linha[]).map(paraRecord);
  }

  function buscarPorId(id: number): AmbienteRecord | undefined {
    const linha = db.prepare(`${SELECT} WHERE a.id = ?`).get(id) as Linha | undefined;
    return linha && paraRecord(linha);
  }

  const criar = db.transaction((novo: NovoAmbiente): AmbienteRecord => {
    const appId = db
      .prepare("INSERT INTO apps_oauth (client_id, client_secret_cifrado, redirect_uri) VALUES (?, ?, ?)")
      .run(novo.app.clientId, novo.app.clientSecretCifrado, novo.app.redirectUri).lastInsertRowid;
    const id = db
      .prepare("INSERT INTO ambientes (url, tipo, app_oauth_id) VALUES (?, ?, ?)")
      .run(novo.url, novo.tipo, appId).lastInsertRowid;
    return buscarPorId(Number(id))!;
  });

  const atualizar = db.transaction((id: number, alteracao: AlteracaoAmbiente): AmbienteRecord | undefined => {
    const atual = buscarPorId(id);
    if (!atual) return undefined;

    const app = { ...atual.app, ...semIndefinidos(alteracao.app ?? {}) };
    db.prepare(
      `UPDATE apps_oauth SET client_id = ?, client_secret_cifrado = ?, redirect_uri = ?, atualizado_em = ${AGORA}
       WHERE id = ?`,
    ).run(app.clientId, app.clientSecretCifrado, app.redirectUri, app.id);
    db.prepare(`UPDATE ambientes SET url = ?, tipo = ?, atualizado_em = ${AGORA} WHERE id = ?`).run(
      alteracao.url ?? atual.url,
      alteracao.tipo ?? atual.tipo,
      id,
    );
    return buscarPorId(id);
  });

  return { listar, buscarPorId, criar, atualizar };
}

function semIndefinidos<T extends object>(valor: T): T {
  return Object.fromEntries(Object.entries(valor).filter(([, v]) => v !== undefined)) as T;
}
