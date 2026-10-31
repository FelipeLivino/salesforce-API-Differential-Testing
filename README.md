# Testes diferenciais de APIs Salesforce

Ferramenta local que executa a mesma chamada com o usuário de integração e com usuários da comunidade, e aponta falhas e diferenças. Nesta fase, ela entrega os cadastros de ambientes (com app OAuth), perfis e contextos, com segredos cifrados em SQLite, e o botão Testar login, que mostra o erro real do Salesforce. A execução diferencial das chamadas ainda não existe. Veja [o briefing](docs/briefing-fase1.md) e [a arquitetura](docs/arquitetura.md).

## Requisitos

- Docker com Docker Compose, para executar em container
- Node.js 24 e npm, para desenvolver e testar fora do container

## Configuração

```bash
cp .env.example .env
```

Em seguida, gere a chave e coloque o valor em `SECRETS_ENCRYPTION_KEY`, no `.env`:

```bash
openssl rand -base64 32
```

| Variável | Uso |
|---|---|
| `APP_PORT` | Porta publicada em `127.0.0.1`. Padrão: 3000 |
| `SECRETS_ENCRYPTION_KEY` | Chave AES-256-GCM, com 32 bytes em base64. Se ela for trocada ou perdida, os segredos já salvos não poderão ser decifrados |
| `DATABASE_PATH` | Opcional fora do Docker. No Compose, é fixada em `/app/data/app.db` |

Nunca coloque o `.env` no Git. O comando `docker compose config` mostra os valores do `.env` na tela, portanto não cole a saída dele em outros lugares.

## Subir com Docker

```bash
docker compose up --build -d
```

Abra <http://127.0.0.1:3000> ou use a porta definida em `APP_PORT`. O serviço é publicado apenas em `127.0.0.1` e não responde pelo IP da máquina na rede.

```bash
docker compose ps            # situação do serviço
docker compose logs -f app   # logs
```

## Segurança local

- `src/proxy.ts` responde 403 a qualquer rota quando `Host` ou `Origin` não for `localhost`, `127.0.0.1` ou `[::1]`. Acesse a ferramenta por um desses nomes.
- `GET /api/status` informa se a chave de criptografia está configurada, sem mostrar a chave.
- Respostas do servidor Salesforce acima de 1 MB são abortadas e aparecem como erro no teste de login.

## Parar

```bash
docker compose down
```

O banco fica no volume `sqlite-data` e continua disponível no próximo `up`. Para apagar **todos os dados locais** de forma definitiva, use `docker compose down -v`.

## Desenvolver sem Docker

```bash
npm ci
npm run dev
```

A aplicação abre em <http://127.0.0.1:3000>.

## Testar

```bash
npm run typecheck
npm test
npm run build
```

Os testes não chamam o Salesforce real nem usam credenciais reais. Toda chamada ao Salesforce deve ir para o servidor falso, em `tests/fake-salesforce`.
