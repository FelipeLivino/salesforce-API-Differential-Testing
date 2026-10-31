-- Cadastros da Fase 1: apps OAuth, ambientes, perfis e contextos.
--
-- Colunas *_cifrada/*_cifrado guardam somente o valor já criptografado por
-- src/server/crypto/secrets.ts. O banco não cifra nem decifra, e token não tem coluna.
-- Perfis não têm carga inicial; nome e tipo_login são texto livre, e tipo_login é
-- validado contra o registro de adaptadores fora do banco.

CREATE TABLE apps_oauth (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id             TEXT NOT NULL CHECK (length(trim(client_id)) > 0),
  client_secret_cifrado TEXT CHECK (client_secret_cifrado IS NULL OR length(client_secret_cifrado) > 0),
  redirect_uri          TEXT CHECK (redirect_uri IS NULL OR length(trim(redirect_uri)) > 0),
  criado_em             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  atualizado_em         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

-- NOT NULL + UNIQUE: todo ambiente tem exatamente um app, e o app é só dele.
CREATE TABLE ambientes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  url           TEXT NOT NULL CHECK (length(trim(url)) > 0),
  tipo          TEXT NOT NULL CHECK (tipo IN ('sandbox', 'producao')),
  app_oauth_id  INTEGER NOT NULL UNIQUE REFERENCES apps_oauth (id) ON DELETE RESTRICT,
  criado_em     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

-- Sem isso, excluir o ambiente deixaria para trás o Client Secret de um app sem uso.
CREATE TRIGGER ambientes_remove_app_oauth
AFTER DELETE ON ambientes
BEGIN
  DELETE FROM apps_oauth WHERE id = OLD.app_oauth_id;
END;

CREATE TABLE perfis (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nome          TEXT NOT NULL CHECK (length(trim(nome)) > 0),
  descricao     TEXT,
  tipo_login    TEXT NOT NULL CHECK (length(trim(tipo_login)) > 0),
  situacao      TEXT NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'arquivado')),
  criado_em     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

-- RESTRICT: ambiente e perfil em uso por um contexto não podem ser excluídos.
CREATE TABLE contextos (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  ambiente_id            INTEGER NOT NULL REFERENCES ambientes (id) ON DELETE RESTRICT,
  perfil_id              INTEGER NOT NULL REFERENCES perfis (id) ON DELETE RESTRICT,
  url                    TEXT NOT NULL CHECK (length(trim(url)) > 0),
  login                  TEXT NOT NULL CHECK (length(trim(login)) > 0),
  senha_cifrada          TEXT NOT NULL CHECK (length(senha_cifrada) > 0),
  security_token_cifrado TEXT CHECK (security_token_cifrado IS NULL OR length(security_token_cifrado) > 0),
  situacao               TEXT NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'arquivado')),
  criado_em              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  atualizado_em          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX contextos_ambiente_id ON contextos (ambiente_id);
CREATE INDEX contextos_perfil_id ON contextos (perfil_id);
