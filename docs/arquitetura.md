# Arquitetura da Fase 1

Um único serviço Next.js (TypeScript estrito), com SQLite em volume local. Decisões e motivos resumidos em [decisoes.md](decisoes.md).

## Estrutura de `src/`

```
src/
  proxy.ts              recusa com 403 Host ou Origin fora de loopback, em todas as rotas
  app/
    (telas)/            páginas: ambientes, perfis, contextos
    api/                Route Handlers: finos, só validam e delegam a src/server
      status/           GET /api/status: situação da chave de criptografia
  components/           componentes React
  lib/api-client.ts     chamadas do frontend às rotas
  shared/
    dto.ts              contratos JSON das rotas, usados por frontend e backend
  server/
    db/
      connection.ts     abre o banco e aplica migrações pendentes
      migrations/       NNN_nome.sql
      repositories/     ambientes, perfis, contextos
    crypto/secrets.ts   AES-GCM, com chave vinda do .env
    auth/
      types.ts          contrato do adaptador
      registry.ts       tipo de login -> adaptador
      token-cache.ts    cache em memória
      login-service.ts  monta a entrada, decifra, usa o cache e chama o adaptador
      oauth-http.ts     HTTP dos adaptadores, limite de 1 MB, regra de destino e montagem de falhas
      userinfo.ts       confirma o token
      adapters/
        username-password.ts
        headless.ts
    services/           cadastros e teste de login
    log/redact.ts       máscara e ponto único de saída (maskOutput)
tests/
  fake-salesforce/      servidor HTTP falso
```

## Módulos e dependências

Sentido único: `app/api` -> `server/services` -> `server/auth` e `server/db`.

- `src/server` nunca importa `next`, `react`, `src/app` ou `src/components`.
- `server/auth/adapters` não acessa banco nem cache: recebe a entrada e faz HTTP.
- `src/components` e `src/app/(telas)` só falam com as rotas, via `lib/api-client.ts`.
- `server/crypto` e `server/log` não dependem de outros módulos.
- O executor e o comparador das próximas fases entram como novas pastas em `src/server`, usando `login-service`.

## Adaptador de login

Novo fluxo = novo arquivo em `adapters/` + uma linha em `registry.ts`. `perfil.tipo_login` é texto no banco, validado contra o registro. Nenhum nome de perfil existe no código.

```ts
// src/server/auth/types.ts
export interface LoginInput {
  loginUrl: string;            // contexto.url
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;        // exigido pelo Headless
  username: string;
  password: string;            // já decifrada; só existe durante a chamada
  securityToken?: string;
  maskValues?: string[];       // outros segredos conhecidos, como o token em cache
}

export interface LoginSuccess {
  ok: true;
  accessToken: string;
  instanceUrl: string;
  issuedAt: Date;
  expiresAt: Date | null;      // só existe se o Salesforce informar expires_in
  expiresAtSource: "salesforce" | "nao-informado";
  maskValues?: string[];       // code, verificador e tokens do fluxo: só para mascarar saídas
}

export interface LoginFailure {
  ok: false;
  kind: "salesforce" | "rede" | "configuracao";
  step?: string;               // etapa do fluxo, ex.: "authorize" ou "token"
  httpStatus?: number;
  error?: string;              // campo `error` do Salesforce; só segredos são mascarados
  errorDescription?: string;   // campo `error_description`; só segredos são mascarados
  rawBody?: string;            // corpo da resposta, mascarado e truncado
  message?: string;            // explicação da própria ferramenta
}

export type LoginResult = LoginSuccess | LoginFailure;

export interface LoginAdapter {
  readonly type: string;       // ex.: "headless", "username-password"
  login(input: LoginInput, signal?: AbortSignal): Promise<LoginResult>;
}
```

Regras:

- Falha esperada é retornada como `LoginFailure`, não lançada. Exceção só para defeito de programação.
- `LoginSuccess` nunca sai de `src/server`. A rota de teste devolve apenas `instanceUrl`, `expiresAt`, `expiresAtSource` e o resultado do teste de token (`/services/oauth2/userinfo`).
- `LoginFailure` chega à tela sem reinterpretação. Toda saída para a API (`error`, `errorDescription`, `rawBody`, `message` e `instanceUrl`) passa por `maskOutput`, em `redact.ts`, com os segredos conhecidos naquele momento, inclusive os tokens da própria resposta (decisões S7 a S9).
- Expiração: usar `expires_in` se vier na resposta. Sem ele, `expiresAt` fica `null`, `expiresAtSource` fica `"nao-informado"`, e o token é reaproveitado até receber 401 (decisão 9).
- URLs: exigir `https`, aceitando `http` só em loopback, para o servidor falso. Não seguir redirecionamentos automaticamente, exceto o previsto no fluxo.
- Destino do token: `sfdc_community_url` e `instance_url` seguem `tokenDestinationProblem` (decisões S3, S10 e S11). Se a URL for inválida, o token não é enviado.
- Corpo das respostas: limitado a 1 MB, com a conexão abortada ao ultrapassar (decisão S4).

## Acesso local

`src/proxy.ts` vale para todas as rotas e responde 403 quando o hostname de `Host`, ou de um `Origin` presente, está fora de `localhost`, `127.0.0.1` e `[::1]` (decisão S1). `GET /api/status` informa se a chave de criptografia está configurada, sem mostrar a chave.

## Cache de tokens

Módulo `token-cache.ts`, com instância única em `globalThis` para sobreviver a bundles separados e ao hot reload.

- Chave: `contextoId`. Valor: `LoginSuccess`. Só em memória, e é perdido ao reiniciar.
- Validade: reaproveita até `expiresAt - 60s`. Item vencido é removido na leitura.
- Concorrência: mapa de promessas em andamento, para evitar logins simultâneos do mesmo contexto.
- Falhas não entram no cache.
- Invalidação: `invalidate(contextoId)` ao editar ou arquivar contexto; `invalidateAll()` ao editar ambiente ou app; `invalidate` também quando o Salesforce responder 401 em uma chamada com o token.
- Interface: `get`, `set`, `invalidate`, `invalidateAll`. O relógio é injetável, para testes.

`login-service.getToken(contextoId, { forceRefresh })` é a única porta de entrada. O botão **Testar login** usa `forceRefresh: true`, pois precisa testar de fato, e grava o novo token no cache se der certo.

## Bibliotecas

| Uso | Escolha | Motivo |
|---|---|---|
| SQLite | `better-sqlite3` | Síncrona e simples para um único processo, madura, com transações diretas. `node:sqlite` ainda não é a opção mais estável. Sem ORM: SQL nas migrações e repositórios. |
| Testes | Vitest | TypeScript sem configuração extra, rápido, com relógio falso nativo. |
| Salesforce falso | `node:http` em porta efêmera | Exercita o `fetch` real, sem dependência nova e sem acesso à rede externa. |

Criptografia usa `node:crypto` e HTTP usa `fetch` nativo. Nenhuma outra dependência é necessária no backend. `better-sqlite3` é nativa: a imagem Docker precisa compilá-la ou baixar o binário, e o banco de testes usa `:memory:`.

## Divisão de arquivos

Cada arquivo tem um único responsável. Quem precisar alterar arquivo de outro pede ao responsável.

| Responsável | Arquivos |
|---|---|
| **DevOps** | `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.env.example`, `.gitignore`, `package.json`, lockfile, `tsconfig.json`, `next.config.*`, `vitest.config.*`, `README.md` |
| **DBA** | `src/server/db/**` |
| **Backend** | `src/app/api/**`, `src/shared/dto.ts`, `src/server/crypto/**`, `src/server/auth/**`, `src/server/services/**`, `src/server/log/**`, `tests/fake-salesforce/**` |
| **Frontend** | `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/(telas)/**`, `src/components/**`, `src/lib/**`, CSS |

Testes ficam ao lado do código (`*.test.ts`), com o dono do arquivo testado. O QA adiciona os seus em `tests/qa/**`.

Ordem e pontos de contato:

1. **DevOps** cria o esqueleto e instala de uma vez: `next`, `react`, `react-dom`, `better-sqlite3`, `typescript`, `vitest` e seus tipos. Assim, os demais não mexem em `package.json`.
2. **DBA** entrega esquema e repositórios, com tipos próprios exportados por `repositories/`. O Backend só consome.
3. **Backend** publica `shared/dto.ts` antes das rotas. O Frontend só consome e pode começar assim que esse arquivo existir.
