# Архитектура ENT Evidence Radar

Документ для тех, кто будет менять код: откуда берутся данные, где живут блокировки и кэши,
какие формулы стоят за «уровнем доказательности» и «индексом доверия», и почему приняты
ключевые решения (ADR внизу). Пользовательская документация — в `README.md`.

## 1. Крупные блоки

```
┌──────────────┐   cron / кнопка    ┌──────────────────────────────────────────────┐
│ instrumentation│ ───────────────▶ │ refresh.ts: startRefresh → source adapters →  │
│ (тик 60 с)    │                   │ dedup (identifiers) → classify() → planWrites │
└──────┬───────┘                    └──────────────┬───────────────────────────────┘
       │ бэкап / дайджест по расписанию            │ articles, fetch_runs, sources
       ▼                                           ▼
┌──────────────┐                    ┌──────────────────────────────────────────────┐
│ backup.ts    │                    │ PostgreSQL  или  PGlite (./.pglite)          │
│ digest.ts    │                    │ drizzle-orm, миграции drizzle/*.sql          │
└──────────────┘                    └──────────────┬───────────────────────────────┘
                                                   │ queries.ts (FTS, фильтры, кэш)
                                                   ▼
                                    ┌──────────────────────────────────────────────┐
                                    │ Next.js App Router: страницы + /api/*        │
                                    │ proxy.ts: CSP nonce + x-request-id           │
                                    └──────────────────────────────────────────────┘
```

| Каталог | Назначение |
| --- | --- |
| `src/app/` | страницы (`/`, `/settings`, `/login`, `/stats`, `/runs`, `/topics`), REST API `src/app/api/**/route.ts`, Atom `feed.xml`, `sitemap`, `og.png` |
| `src/components/` | клиентские компоненты: `Feed` (лента, фильтры, пресеты, горячие клавиши), `ArticleDrawer` (карточка, ИИ, правки, цитаты), `SettingsPanel`, `RefreshButton`, `ServiceWorkerRegistrar` (офлайн-режим, см. § 6a) |
| `src/db/` | `index.ts` — выбор движка и миграции при старте; `schema.ts` — единственный источник правды о таблицах |
| `src/lib/evidence/` | чистое ядро без I/O: `classify.ts` (дизайн, уровень, доверие, нормализация идентификаторов, ключ дедупликации), `journals.ts` (белый список журналов по tier + список сомнительных издательств), `guidelines.ts` (органы-издатели руководств), `taxonomy.ts` (метки) |
| `src/lib/sources/` | адаптеры источников: `pubmed`, `europepmc`, `clinicaltrials`, `medrxiv`; `crossref` (редакционные уведомления по DOI); общий `http.ts` (таймауты, повторы, `Retry-After`, метрики) |
| `src/lib/refresh.ts` | оркестрация обновления, DB-лок, восстановление зависших запусков |
| `src/lib/evidence/pico.ts` | PICO из секций аннотации или эвристик по тексту; чистая функция, считается на клиенте |
| `src/lib/public-api.ts` | публичные read-маршруты: ETag/`If-None-Match`, `Last-Modified`/`If-Modified-Since` → 304; мягкий rate-limit (сессия → токен → IP) |
| `src/lib/trials.ts` | отслеживание сохранённых КИ по NCT: статусы, результаты, история событий (`trial_info`), всплытие изменений в ленте |
| `src/lib/retraction.ts`, `reclassify.ts` | пост-обработка после обновления: перепроверка отзывов в PubMed (по PMID) и в Crossref (по DOI: отзыв, withdrawal, expression of concern, исправление → `editorial_notice`); переразметка записей со старой `classifier_version` |
| `src/lib/queries.ts`, `search.ts`, `filters.ts` | выборка статей: разбор фильтров, RU↔EN синонимы, FTS-запрос, пагинация |
| `src/lib/security.ts`, `session.ts`, `rate-limit.ts` | авторизация (`checkApiAuth`), подписанная cookie-сессия, кросс-инстансный rate-limit |
| `src/lib/ai.ts` | ИИ-резюме/перевод: семафор, суточный бюджет в БД, LRU-кэш, стриминг с таймаутами |
| `src/lib/backup.ts`, `digest.ts`, `digest-schedule.ts`, `mailer.ts`, `alerts.ts` | резервные копии и восстановление-слияние; письмо-дайджест и его расписание; SMTP; алерты о сбоях |
| `src/lib/diagnostics.ts`, `metrics.ts`, `log.ts` | экран диагностики, внутрипроцессные счётчики, JSON-логи с `requestId` |
| `src/instrumentation.ts` | планировщик долгоживущего процесса (тик раз в минуту) |
| `src/proxy.ts` | CSP с nonce, `x-request-id` (конвенция Next 16: `proxy` вместо `middleware`) |
| `scripts/migrate.mjs` | отдельный запуск миграций (`npm run db:migrate`) с advisory-lock и pre-migration снимком |

## 2. Поток данных обновления

1. **Запуск.** `POST /api/refresh` (ответ `202 {runId}`) или планировщик. `startRefresh()`:
   внутрипроцессный флаг `globalThis.__entRadarRunning` → DB-лок (см. §4) → строка `fetch_runs(status=running)`.
   Если лок занят — `skipped`, второй запуск не создаётся.
2. **Сбор.** Адаптеры опрашиваются параллельно по каждой включённой теме (`topics.query*`).
   PubMed получает запрос темы как есть; Europe PMC — его перевод `pubmedToEpmcQuery()` (`src/lib/sources/epmc-query.ts`:
   AST запроса, теги полей → поля Europe PMC, невыразимое отбрасывается только в сторону расширения выборки, иначе
   страховочный запрос `EPMC_FALLBACK_QUERY`). ClinicalTrials.gov и medRxiv — по общему ЛОР-фильтру без тем.
   Ошибка одного источника не роняет запуск: статус пишется в `sources.last_status/last_error`,
   запуск получает `partial`. HTTP-слой: таймаут, до 3 повторов с экспоненциальной паузой,
   уважение `Retry-After`, лимит NCBI 3 (10 с `NCBI_API_KEY`) запросов/с.
3. **Нормализация и дедупликация.** `normalizeIds()` приводит DOI/PMID/NCT к канонической форме;
   `dedupKeyFor()` выбирает ключ по приоритету `doi → pmid → nct → normalizedTitle|year`.
   `makeCandidateCollector()` сливает записи **транзитивно** внутри пачки (PubMed + Europe PMC +
   препринт с `publishedDoi`), объединяя `sourceKeys`, `topicIds` и выбирая более «богатую»
   запись (`richness()`: источник, аннотация, PMID, MeSH).
4. **Классификация.** `classify(raw, overrides)` — чистая функция (§3). Ручные правки
   (`articles.overrides`) применяются поверх эвристик, поэтому переразметка их не трогает.
5. **Запись.** `planWrites()` сравнивает кандидатов с базой (по `dedup_key`, затем по PMID/DOI/NCT)
   и решает: insert / update метаданных / только добавить источник и темы. Пользовательские поля
   (`is_read`, `is_bookmarked`, `note`, `overrides`, `is_hidden`) никогда не перезаписываются;
   скрытые записи (`is_hidden`) не «воскресают».
6. **Пост-обработка.** `recheckRetractions()` — сверка `isRetracted` с PubMed батчами по 200 PMID,
   курсор в `settings.retraction_cursor`; `reclassifyArticles()` — до 2000 записей с
   `classifier_version < CLASSIFIER_VERSION`; инвалидация TTL-кэша агрегатов; алерты при серии сбоев.

## 3. Формулы классификатора (`src/lib/evidence/classify.ts`)

`CLASSIFIER_VERSION` увеличивается при любом изменении эвристик — тогда старые записи
переразмечаются автоматически.

**Дизайн исследования** определяет `detectDesignDetailed` — слоями от надёжных признаков к слабым
(I-03): подсказка реестра КИ → тип публикации PubMed → журнал Cochrane → заголовок → аннотация.
Вместе с дизайном сохраняются **объяснение** (`design_reason`: источник признака и найденный
фрагмент, например «заголовок: «randomised»») и **уверенность** (`design_confidence`: `high` —
структурированный признак или ручная правка, `medium` — заголовок, `low` — только аннотация или
признаков нет; карточка подсказывает проверить такие записи вручную). Затем — **уровень
доказательности** (1 — лучший):

| Дизайн | Уровень |
| --- | --- |
| systematic_review, guideline | 1 |
| rct | 2 (3, если n < 50) |
| cohort | 3 (2, если n ≥ 1000) |
| secondary_analysis (вторичный / post-hoc анализ РКИ) | 3 (2, если n ≥ 1000) |
| diagnostic_accuracy (диагностическая точность, прогностические модели) | 3 (2, если n ≥ 200) |
| case_control, economic, mendelian_randomization | 3 |
| cross_sectional | 4 (3, если n ≥ 1000) |
| case_series, trial_registry | 4 |
| protocol, qualitative, narrative, preprint, other | 5 |

**Индекс доверия** — сумма слагаемых, обрезанная в `[0, 100]`; каждое слагаемое сохраняется в
`trust_breakdown`, и карточка показывает его пользователю:

| Слагаемое | Баллы |
| --- | --- |
| Дизайн | SR 40 · guideline 38 · RCT 34 · cohort 22 · diagnostic 20 · case-control 18 · Mendelian 18 · secondary analysis 16 · cross-sectional 14 · economic 14 · registry 12 · case series 8 · narrative 6 · qualitative 6 · other 5 · preprint 4 · protocol 4 |
| Журнал (`journals.ts`) | Tier 1 +30 · Tier 2 +26 · Tier 3 +16 · вне списка +4 · сомнительное издательство −35. Сопоставление: паттерны «хищников» по названию → ISSN записи (`articles.issns`, из PubMed `<ISSN>`/`<ISSNLinking>` и Europe PMC `issn`/`essn`) → нормализованное название/ISO-аббревиатура |
| Источник | PubMed +10 · Europe PMC +8 · CT.gov +6 · medRxiv 0 |
| Регистрация протокола (PROSPERO/NCT/ISRCTN) | +6 |
| Стандарт отчётности (GRADE/PRISMA/CONSORT/STROBE) | +4 |
| Размер выборки | n ≥ 1000 +8 · ≥ 200 +5 · ≥ 50 +2 |
| Для РКИ: double-blind / placebo / ITT | +3 / +2 / +2 |
| Многоцентровое (кроме SR) | +3 |
| Препринт | −20; есть журнальная версия (`published_doi`) +5 |
| Отозвана | −60 |
| Нет или короткая аннотация | −4 |
| CT.gov с опубликованными результатами | +8 |
| Пилотное / предварительное | −5 |
| Доклиническое (животные / in vitro) | −10 |

Размер выборки извлекается `extractSampleSize()` с защитой от годов («2019 patients were
included» → контекст даты игнорируется) и диапазонов.

## 4. Где живут блокировки, курсоры и кэши

| Что | Где | Семантика |
| --- | --- | --- |
| Лок обновления | `settings.key = 'lock_refresh'` → `{holder, expiresAt}` | аренда 6 мин (`LOCK_LEASE_MS`), продлевается держателем; истёкшую аренду можно перехватить. Плюс внутрипроцессный флаг. Диагностика: `GET /api/admin/diagnostics`, принудительное снятие — `POST {action:"release_lock"}` (409, если держатель жив в этом процессе) |
| Зависшие запуски | `fetch_runs.status='running'` старше аренды | `recoverStaleRuns()` на старте и каждым тиком помечает их `failed` |
| Курсор отзывов | `settings.retraction_cursor` → `{lastId}` | обход по возрастанию `id`, по кругу |
| Состояние дайджеста | `settings.digest_state` | последняя отправка (ключ периода) — защита от повторов при нескольких инстансах |
| Настройки приложения | `settings.app` (`AppSettings` из `defaults.ts`) | валидируются в `PATCH /api/settings` и при восстановлении бэкапа |
| ИИ-бюджет | `settings.ai_usage` (счётчик за сутки, общий для инстансов) + `ai_cache` (ответы) | `AI_DAILY_BUDGET`, `AI_MAX_CONCURRENCY`; LRU в памяти поверх таблицы |
| Rate-limit | таблица `rate_limits` (`rate-limit.ts`), fallback — in-memory | login 10/10 мин по IP; `/api/ai` 30/мин; `/api/refresh` 5/мин |
| TTL-кэш агрегатов | память процесса (`cache.ts`, префикс `articles:`) | итоги на главной 30 с; **инвалидируется событиями** (PATCH/DELETE/bulk, конец обновления), не только по времени |
| Остановка процесса | `src/lib/shutdown.ts` (реестр хуков, флаг `isShuttingDown`) | SIGTERM/SIGINT → health 503 → дренаж 1,5 с → хуки по порядку: планировщик, прерывание refresh (`abortCurrentRefresh`: run → failed, лок снят), закрытие БД; в Docker `NEXT_MANUAL_SIG_HANDLE=true` |
| Миграции | `pg_advisory_lock(727272001)` | несколько реплик не применяют одну миграцию одновременно; перед новыми миграциями — снимок в `BACKUP_DIR` |

Все состояния, которые должны быть общими для нескольких инстансов, лежат в БД; в памяти —
только кэш и счётчики, потеря которых безопасна.

## 5. Поиск

- Генерируемая колонка `articles.search_tsv` (`to_tsvector('english', …)`, веса A/B/C/D) с GIN-индексом (миграция `0008`).
- `search.ts`: запрос разбивается на концепт-группы; каждая русская или английская группа расширяется
  словарём `SYNONYMS` (≈350 понятий ЛОР: болезни, операции, препараты, синдромы, общие слова),
  включая префиксное разрешение неполного слова. Группы соединяются **AND**, варианты внутри — **OR**,
  всё в синтаксисе `websearch_to_tsquery('english', …)` с одинаковой конфигурацией для документа и запроса.
- При непустом запросе сортировка по умолчанию `relevance` (`ts_rank_cd`); `scope=title` ищет только по заголовку.
- Ответ `/api/articles` содержит `searchTerms` — клиент подсвечивает их (`Highlight.tsx`), для терминов ≥ 5 символов допускается расширение суффиксом.

### Индексы `articles` (все объявлены в `schema.ts`)

| Индекс | Зачем |
| --- | --- |
| `articles_dedup_key_idx` (unique), `articles_pmid_unique_idx` / `articles_doi_unique_idx` (частичные unique) | дедупликация и защита от дублей при гонках/импорте |
| `articles_pmid_idx`, `articles_doi_idx`, `articles_published_doi_idx` (`lower(published_doi)`), `articles_nct_upper_idx` (`upper(nct_id)`) | поиск существующих строк по идентификаторам в `planWrites`, восстановлении из бэкапа, связи препринт ↔ журнал и публикация ↔ реестр КИ |
| `articles_search_tsv_gin` | полнотекстовый поиск |
| `articles_subspecialties_gin`, `articles_source_keys_gin`, `articles_topic_ids_gin` | фильтры `@>` по jsonb-массивам (субспециальность, источник, тема) |
| `articles_study_design_idx`, `articles_evidence_level_idx`, `articles_trust_idx` | фильтры по дизайну/уровню/порогу доверия и сортировка по доверию |
| `articles_published_at_idx`, `articles_fetched_at_idx` | сортировки «по дате» / «по сбору» (в т. ч. Atom-лента) и фильтры по периоду |
| `articles_classifier_version_idx` | выборка записей на переклассификацию |
| `articles_hidden_idx` (частичный, `is_hidden`) | режим «скрытые мной» без влияния на основную ленту |

Отдельный btree по `is_hidden = false` не нужен: это почти все строки, планировщик идёт по индексу сортировки и фильтрует.

## 6. Планировщик (`src/instrumentation.ts`)

Один `setInterval` 60 с в долгоживущем процессе (`unref`): восстановление зависших запусков →
автообновление, если прошло `refreshIntervalMinutes` → автобэкап раз в `AUTO_BACKUP_HOURS` →
дайджест (`isDigestDue`). На serverless планировщик не живёт — внешний cron вызывает `POST /api/refresh`
(см. `.github/workflows/refresh.yml`). Состояние планировщика видно в `/api/health` и диагностике.

## 6a. Офлайн-режим: service worker (`public/sw.js`)

Обычный JS без сборки (Turbopack его не трогает), версия в константе `VERSION` — её смена
инвалидирует все кэши `radar-*` на активации. Регистрирует `ServiceWorkerRegistrar` (в `layout.tsx`)
только при `NODE_ENV=production` и без `DISABLE_SW=1`; иначе снимает регистрацию, чтобы
dev-сервер и HMR не конфликтовали с кэшем.

| Запрос | Стратегия | Кэш |
| --- | --- | --- |
| Навигация (`mode: navigate`) | сеть (таймаут 8 с) → копия той же страницы → `/offline` | `radar-shell-*`, кэшируются только `/`, `/stats`, `/runs`, `/topics`, `/offline` (не `/login`, `/settings`) |
| `/_next/static/*`, `/fonts/*` | cache-first (имена файлов хэшированы) | `radar-static-*` |
| manifest, иконки, `og.png` | stale-while-revalidate | `radar-static-*` |
| Публичные GET: `/api/articles`, `/api/articles/:id`, `/api/articles/:id/related`, `/api/topics`, `/api/sources`, `/api/stats` | network-first; при сбое — копия с `x-sw-cache: hit` и `x-sw-cached-at` | `radar-api-*`, ≤ 80 записей (вытесняются самые старые) |
| Всё остальное (не-GET, чужой origin, auth/admin/ai/runs/health/export/backup, `/sw.js`) | мимо воркера | — |

Кэшируются только ответы `200` (не `opaque`, не 304). Сообщение `{type: "clear-cache"}` удаляет кэши API
и оболочки — его шлёт `AuthStatus` при выходе, чтобы на общем устройстве не остались закладки/заметки
из ответов ленты. Лента (`Feed.tsx`) читает заголовки `x-sw-*` и `navigator.onLine` и показывает
баннер «Нет соединения» / «Данные из офлайн-кэша» с датой сохранения. `/sw.js` отдаётся с
`Cache-Control: no-cache`, чтобы новая версия доезжала сразу (правило в `next.config.ts`).

Граница клиент/сервер охраняется тестом `src/lib/client-boundary.test.ts`: клиентский компонент,
транзитивно импортирующий `@/db`, `pg`, PGlite или node-модули, ломает `next build` — тест находит
такую цепочку импортов раньше сборки.

## 7. API-контракты

Описание всех маршрутов — `docs/openapi.yaml` (OpenAPI 3.1). Общие правила:

- Ошибки — `{error, requestId?}`; валидация тела через zod (`parseBody`), ответ 400 с перечнем полей.
- Каждый ответ несёт `x-request-id` (принимается от доверенного прокси, иначе генерируется) — он же в JSON-логах.
- Долгие операции асинхронны: `POST /api/refresh` → 202, прогресс — `GET /api/runs/:id`.
- Списки отдают `{items, total, page, pageSize}`.

## 8. ADR — ключевые решения

**ADR-1. PGlite по умолчанию, PostgreSQL в продакшене.** Радар должен запускаться одной командой
без внешних сервисов, поэтому без `DATABASE_URL` используется встроенный PGlite (файл `./.pglite`).
Цена — отсутствие WAL-гарантий при аварийном завершении и один процесс-писатель. Компромисс:
общий код через drizzle (одни миграции на оба движка), предупреждение в логах при старте,
`PGLITE_RESET_ON_FAILURE` по умолчанию выключен (данные не стираются молча), регулярные JSON-бэкапы
пользовательских полей. Для нескольких инстансов и Vercel — только PostgreSQL.

**ADR-2. Классификация — детерминированные эвристики, а не LLM.** Решение должно быть
воспроизводимым, объяснимым (`trust_breakdown` показывается врачу) и бесплатным на тысячах записей.
LLM используется только по запросу пользователя (резюме/перевод) с бюджетом. Ошибки эвристик
исправляются ручными правками (`overrides`), которые классификатор уважает.

**ADR-3. Одна запись на публикацию.** Препринт и журнальная версия, PubMed- и Europe PMC-копии
сливаются в одну строку по идентификаторам (`dedupKeyFor`, транзитивный сборщик). Иначе пользователь
видит дубли, а закладки/заметки расползаются.

**ADR-4. Состояние — в БД, кэш — только в памяти.** Любое значение, от которого зависит
корректность при нескольких инстансах (лок, курсор, бюджет ИИ, rate-limit, состояние дайджеста),
хранится в `settings`/таблицах; in-memory остаются только TTL-кэш агрегатов и метрики процесса.

**ADR-5. Сессия — подписанный токен без состояния.** `v1.<exp>.<nonce>.<hmac>` в httpOnly-cookie
на 30 дней; сервер ничего не хранит и не ходит в БД на каждый запрос; отзыв всех сессий — смена
`SESSION_SECRET`. Подробности — `SECURITY.md`.

**ADR-6. Асинхронный refresh.** Обновление может занимать минуты (четыре источника × 14 тем ×
rate-limit NCBI). Синхронный HTTP-ответ упирался в таймауты прокси, поэтому `POST /api/refresh`
возвращает `202` сразу, а прогресс читается из `fetch_runs`.

## 9. Как добавить…

- **Источник**: адаптер в `src/lib/sources/<key>.ts` с интерфейсом остальных (возвращает `RawArticle[]`),
  запись в `defaults.ts` (`DEFAULT_SOURCES`) и метку в `taxonomy.ts` (`SOURCE_LABELS`); баллы источника в `classify.ts`.
- **Эвристику классификатора**: правка в `classify.ts` + тест в `classify.test.ts` + инкремент `CLASSIFIER_VERSION`.
- **Миграцию**: изменить `schema.ts` → `npm run db:generate` → проверить SQL → `npm run db:check` в CI.
- **Поле настроек**: `AppSettings`/`DEFAULT_SETTINGS` в `defaults.ts`, схема в `PATCH /api/settings`,
  белый список в `backup.ts` (restore), UI в `SettingsPanel.tsx`.
