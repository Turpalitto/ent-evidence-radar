# ---------- deps ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# На этапе сборки БД не нужна: проект использует in-memory PGlite (см. src/db/index.ts).
RUN npm run build

# ---------- runtime ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Непривилегированный пользователь
RUN addgroup -S app && adduser -S app -G app

# Standalone-сборка (next.config.ts -> output: "standalone")
COPY --from=build --chown=app:app /app/.next/standalone ./
# Статика и публичные файлы standalone не копирует сама
COPY --from=build --chown=app:app /app/.next/static ./.next/static

# Миграции Drizzle нужны в рантайме: db/index.ts применяет их при старте
COPY --from=build --chown=app:app /app/drizzle ./drizzle

# Данные PGlite по умолчанию кладутся в process.cwd()/.pglite
RUN mkdir -p /app/.pglite && chown -R app:app /app
VOLUME ["/app/.pglite"]
USER app

EXPOSE 3000
CMD ["node", "server.js"]
