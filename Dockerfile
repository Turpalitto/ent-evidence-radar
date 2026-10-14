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
# Коммит сборки — показывается в диагностике (A-12): docker build --build-arg GIT_SHA=$(git rev-parse HEAD)
ARG GIT_SHA=""
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    GIT_SHA=$GIT_SHA \
    # Сигналы обрабатывает приложение (src/lib/shutdown.ts): прервать refresh, снять блокировку, закрыть PGlite
    NEXT_MANUAL_SIG_HANDLE=true

# Непривилегированный пользователь с ФИКСИРОВАННЫМ UID/GID 1001 (аудит F-17): bind-mount
# каталогов ./docker-data и ./backups с хоста требует предсказуемого владельца —
# `chown -R 1001:1001 docker-data backups` на хосте (см. README). Раньше `adduser -S`
# выдавал системный UID, который отличался от образа к образу.
RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

# Standalone-сборка (next.config.ts -> output: "standalone")
COPY --from=build --chown=app:app /app/.next/standalone ./
# Статика и публичные файлы standalone не копирует сама
COPY --from=build --chown=app:app /app/.next/static ./.next/static

# Миграции Drizzle нужны в рантайме: db/index.ts применяет их при старте
COPY --from=build --chown=app:app /app/drizzle ./drizzle

# Данные PGlite по умолчанию кладутся в process.cwd()/.pglite, бэкапы — в BACKUP_DIR (по умолчанию ./backups)
RUN mkdir -p /app/.pglite /app/backups && chown -R app:app /app
VOLUME ["/app/.pglite", "/app/backups"]
USER app

EXPOSE 3000
# HEALTHCHECK в самом образе (а не только в compose): `docker run` и оркестраторы без compose
# тоже видят состояние. /api/health без параметров отвечает 200, пока БД доступна.
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
