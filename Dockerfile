FROM node:24-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# O .npmrc desativa scripts de instalação: o better-sqlite3 usa o binário pronto do pacote.
FROM base AS deps
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

# Somente dependências de produção.
FROM deps AS prod-deps
RUN npm prune --omit=dev

FROM base AS runner
ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/app.db
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY package.json next.config.mjs ./
# As migrações são lidas em tempo de execução.
COPY src/server/db/migrations ./src/server/db/migrations
# Sem pasta public/ por enquanto; o volume herda o dono desta pasta.
RUN mkdir -p /app/data && chown -R node:node /app/data /app/.next
USER node
EXPOSE 3000
# Dentro do container escuta em todas as interfaces; o Compose publica só em 127.0.0.1.
CMD ["node_modules/.bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
