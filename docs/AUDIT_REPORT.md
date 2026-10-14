# Отчёт глубокого аудита: ENT Evidence Radar

**Дата:** 2026-10-14 · **Коммит:** `a4d495b` (`main`) · **Методология:** `docs/AUDIT_PROMPT.md`
**Среда проверки:** Node 22.22, npm 10.9; внешняя сеть ограничена (NCBI/Europe PMC/CT.gov/medRxiv/Google Fonts недоступны — это само по себе дало одну находку).

---

## Статус исправлений

| Спринт | Находки | Состояние |
|---|---|---|
| 0 «стоп-кран» | F-01 (сессионная cookie-авторизация, заголовки больше не являются аутентификацией, тесты переписаны), F-02 (БД никогда не удаляется: fail-fast либо карантин `.pglite.broken-<дата>` по `PGLITE_RESET_ON_FAILURE=1`), F-03 (`stopNodes` + полное декодирование сущностей + fixture-тесты парсера), F-10 (общие `parseId`/`readJsonObject`, 400/404 вместо 500, лимиты полей тем, проверка субспециальности), F-22 (`npm audit fix`, postcss 8.5.30, `dotenv` удалён; prod-зависимости — 0 уязвимостей), F-25 (имя пакета, `engines`), F-34 (README/.env.example) | ✅ выполнено, проверено живыми запросами (см. §2.3 — теперь все попытки обхода дают 401) |
| 1 | F-04 (Inter self-hosted из `public/fonts`, сборка не ходит в Google Fonts; `X-Frame-Options: DENY`), F-06 (журнал Cochrane → систематический обзор, кроме протоколов/withdrawn), F-07 (`journals.ts` переписан в таблицу: ISO/MEDLINE-аббревиатуры Europe PMC, подзаголовки PubMed « : official journal…», сабжурналы Lancet/JAMA с собственным tier, +30 журналов), F-11 (регистрация/многоцентровость — точные регулярки вместо `registered`/`international`), F-12 («adenoid cystic» ≠ педиатрия, «allergen immunotherapy» ≠ онкология), F-13 (secondary/post-hoc анализ РКИ → когорта), F-33 частично (`n = 2024` читается как выборка, «from 2015 to 2019 patients» — как годы), I-04 + A-03 (`CLASSIFIER_VERSION`, колонка `classifier_version` + миграция 0006, `reclassifyArticles` с PGlite-тестом, `GET/POST /api/admin/reclassify`, догоняющая переразметка до 2000 записей в конце каждого refresh — строка «Переклассификация» в журнале), F-18 (статус `degraded` у PubMed при частичных сбоях тем, жёлтый индикатор в UI и `degraded` в `/api/status`), F-19 (AbortController + отложенный первый запрос ленты: один `/api/articles` на маунт вместо 2–3, поздний ответ не перетирает актуальный), F-20 (`csvEscape` с префиксом `'` для `= + - @ \t \r`, тесты), F-21 (несколько получателей дайджеста — в BCC) | ✅ выполнено: `tsc`, `eslint`, 141 тест, `next build` офлайн |
| 2 | F-05 + I-01 (асинхронный refresh: `POST /api/refresh` → 202 `{runId}` + `after()`, `GET /api/runs/:id`, прогресс по источникам пишется в журнал по ходу, зависшие `running` закрываются под блокировкой, `?wait=1` для скриптов, кнопка и `refresh.yml` опрашивают запуск; интеграционный тест полного цикла на PGlite), F-08 + F-23 + F-24 (ИИ: суточный бюджет в БД `AI_DAILY_BUDGET` → 429, семафор `AI_MAX_CONCURRENCY`, `/api/ai` принимает `articleId` вместо произвольного текста, прогрев только для открытой карточки + 2 соседних, таймаут простоя потока 20 с / потолок 120 с, обрезанный ответ помечается и не кэшируется, LRU 500 в памяти, `PROMPT_VERSION` в ключе кэша, `pruneAiCache` 180 дней/20k строк в конце refresh), F-14 (medRxiv: обход всех страниц окна с лимитом страниц/времени, `truncated` → `degraded`/`partial`), F-15 (лёгкая перепроверка отзывов одним esearch POST `(id[uid] OR …) AND "retracted publication"[pt]` с fallback на efetch), F-16 (`drizzle.config.ts`, миграция 0007 выравнивает снапшот, `npm run db:check` в CI), F-17 (uid/gid 1001, `HEALTHCHECK` в образе, volume для бэкапов, инструкция `chown`), I-07 частично (zod `parseBody` для `/api/ai`, `/api/ai/warm`, `/api/settings`, `/api/backup/restore`; структурированные JSON-логи `src/lib/log.ts` без pino), I-08 (`/api/health` с `lastRun`/`scheduler`/`lockHolder`/`refreshStale`, `?strict=1` → 503, `?metrics=1` — счётчики NCBI/Europe PMC/CT.gov/medRxiv/ИИ; алерт в вебхук/e-mail при N подряд упавших запусков и при восстановлении), I-10 (`npm audit --omit=dev`, `drizzle-kit check`, docker build + smoke-тест контейнера в CI, Dependabot), A-02 (`POST /api/backup/restore` со слиянием по PMID→DOI→NCT, ротация `user_backup_<дата>.json` + `_latest`, `BACKUP_KEEP`, автобэкап раз в `AUTO_BACKUP_HOURS` из планировщика, кнопка восстановления в настройках; PGlite-тест). A-01 закрыт Спринтом 0 | ✅ выполнено: `tsc`, `eslint`, 23 файла / 167 тестов, `next build` офлайн. **Перенесено в Спринт 3:** A-04 (Crossref/Retraction Watch — семантику API нельзя проверить офлайн), полный I-07 (zod на оставшихся маршрутах, `requestId`) |
| 3 | F-09 + I-02 (полнотекстовый поиск: генерируемая колонка `articles.search_tsv` с весами A/B/C/D + GIN, миграция 0008; RU→EN синонимы по группам через OR, слова через AND; `sort=relevance` по `ts_rank_cd` — по умолчанию при запросе; `scope=title`; `searchTerms` в ответе и подсветка `<mark>` в ленте), F-26 (проверено), F-27 (Atom: `<author>`, корректные IRI в `<id>`), F-28 (`GET /api/digest` под авторизацией; `/api/status` скрывает тексты ошибок от анонимов), F-29 (удаление темы отвязывает её id от статей — `detachedArticles` в ответе, PGlite-тест), F-30 (сохранение настроек с обработкой ошибок), F-31 (русские подписи в письме дайджеста), F-32 (`fetchWithRetry` уважает `Retry-After` — секунды и HTTP-дата, потолок 60 с; 429 сдвигает окно троттлинга; троттлинг резервирует слоты — N параллельных вызовов уходят с шагом `throttleMs`), F-33 (PubMed: Retraction of Publication / Published Erratum / Corrected and republished / Expression of Concern отбрасываются при парсинге; эвристика годов в размере выборки — со Спринта 1), I-12 (ключ rate-limit: сессия → API-токен → IP; `ip:unknown` без `TRUST_PROXY`), I-13 (нормализация DOI/PMID/NCT, `dedupKeyFor` с годом для безидентификаторных записей, слияние внутри пачки по общему PMID/DOI/NCT с «поглощением» ранее независимых кандидатов, объединение нескольких обновлений одной строки в `planWrites`), I-15 (`npm run db:migrate`, `MIGRATE_ON_START`, advisory-lock для PostgreSQL, снимок `pre_migration_<дата>.json` перед новыми миграциями), I-11 (TTL-кэш агрегатов главной 30 с с инвалидацией по PATCH статьи/refresh/реклассификации/восстановлению), I-07 (остаток: `x-request-id` из proxy во все ответы и в JSON-логи, единый `apiFailure` → 500 без внутренних деталей, но с `requestId`), A-13 (Vancouver / ГОСТ Р 7.0.5 / BibTeX в карточке + `format=bibtex` в экспорте) | ✅ выполнено: `tsc`, `eslint`, 28 файлов / 201+ тестов, `next build` офлайн, `drizzle-kit check` |
| 4 | A-11 (ручные правки: колонка `overrides` + `is_hidden`, миграция 0009; `classify(raw, overrides)` — дизайн/субспециальности врача поверх эвристик, уровень и индекс доверия от выбранного дизайна; `planWrites`/`reclassify` читают правки существующих строк; `PATCH /api/articles/:id {overrides, isHidden}` с мгновенной переклассификацией; `DELETE` = скрытие (`?purge=1` — физическое), скрытые исключены из ленты/статистики/дайджеста/RSS/похожих и не возвращаются при refresh; режим «Показать скрытые мной»; бэкап/восстановление переносят правки и скрытия; UI-блок «Исправить классификацию» в карточке; интеграционные тесты) | ✅ |
| 5 | A-05 (`articles.published_doi` + миграция 0010; medRxiv `published` → `publishedDoi`; слияние препринта с журнальной версией внутри пачки в любом порядке; при сохранённой журнальной версии препринт только связывается (`linkOnly`), при сохранённом препринте журнальная версия обновляет ту же строку и переводит её идентичность (dedupKey/DOI) на журнал — без флип-флопа между источниками; +5 к доверию препринта с журнальной версией; бейдж и ссылка «Журнальная версия (DOI)» в карточке; 4 теста) | ✅ |
| 6 | A-09 (подписка на дайджест в UI: `digestEnabled/digestRecipients/digestWeekday/digestHour/digestDays` в `AppSettings` с zod-валидацией e-mail; `src/lib/digest-schedule.ts` — `isDigestDue` (день/час/окно 6 ч/защита от повтора 20 ч), состояние `settings.digest_state`; планировщик шлёт по расписанию; `GET /api/digest` отдаёт предпросмотр + состояние подписки, `POST` — отправка сейчас с получателями из настроек; блок в настройках с предпросмотром во `iframe sandbox`; восстановление из бэкапа переносит эти настройки; 3 теста) | ✅ |
| 7 | A-12 (`src/lib/diagnostics.ts` + `GET/POST /api/admin/diagnostics`: версия/коммит `GIT_SHA` (Dockerfile ARG, CI build-arg), аптайм, планировщик, движок и размер БД, счётчики, блокировка с остатком аренды и принудительным снятием (409, если обновление идёт в этом процессе), курсор отзывов и его сброс, бэкапы, дайджест, источники с ошибками, последние запуски, расход ИИ, метрики, флаги окружения без значений; секция в настройках; 2 теста) | ✅ |
| 8 | I-14 (`POST /api/articles/bulk` — массовые флаги до 200 id с zod-валидацией; кнопка «Страницу прочитано» с оптимистичным обновлением; темы и источники («почему в ленте») в метаданных карточки; пользовательские пресеты фильтров в `localStorage` с сохранением/применением/удалением; словарь поиска дополнен ~50 терминами операций/онкологии/слуха — «тонзиллэктомия» раньше не находила tonsillectomy; +2 теста) | ✅ |
| 9 | I-16 (`docs/ARCHITECTURE.md`: блоки, поток обновления, формулы классификатора, таблица «где живут локи/курсоры/кэши», ADR-1…6, «как добавить»; `SECURITY.md`: модель угроз, сессии и секреты, чек-лист деплоя; `CHANGELOG.md` в формате Keep a Changelog; README: устаревший абзац про ILIKE/pg_trgm заменён, добавлен раздел «Документация для разработчиков») | ✅ |
| 10 | A-14 (`docs/openapi.yaml`, OpenAPI 3.1: 27 путей, схемы Article/Topic/Source/FetchRun/Settings/Health/Backup, security-схемы Bearer/X-API-Key/cookie; контракт-тест `openapi.test.ts` сверяет пути и методы спецификации с реальными `route.ts` и разрешимость всех `$ref`). Попутно миграция `0011_drop_trgm_indexes`: четыре триграммных GIN-индекса обслуживали удалённый ILIKE-поиск и только замедляли вставку | ✅ |
| 11 | I-09 (fixture-тесты адаптеров Europe PMC и ClinicalTrials.gov на реальных форматах ответов: маппинг полей, препринты, NCT из аннотации, страны/фазы/результаты, построение запросов, связка с `classify()`; сквозной тест `scripts/migrate.mjs`: чистая база → идемпотентность → pre-migration снимок с закладкой перед новыми миграциями; e2e в браузере — вне песочницы) | ✅ |
| 12 | R-01 (вне списка аудита, найдено при подготовке ARCHITECTURE.md): штатная остановка — раньше SIGTERM закрывал PGlite «наперегонки» с `process.exit` Next, а идущее обновление оставляло запуск `running` и блокировку на 6 мин. Теперь `src/lib/shutdown.ts` (реестр хуков с порядком, идемпотентность, таймаут), `abortCurrentRefresh()` (run → failed, лок снят), `closeDb()`, health 503 при дренаже, `NEXT_MANUAL_SIG_HANDLE=true` в Dockerfile, guard от наложения тиков планировщика; 4 теста + проверено живым SIGTERM на standalone-сервере | ✅ |
| 13 | A-07 (частично, «алерты вне открытой вкладки» без push-инфраструктуры): Atom-лента принимает фильтры `/api/articles` → подписка на сохранённый поиск в любой RSS-читалке (заголовок описывает фильтры, self/alternate-ссылки с параметрами, персональные флаги не утекают); кнопка «RSS для этого фильтра» в боковой панели; `src/lib/feed.ts` + 5 тестов; OpenAPI обновлён | ✅ |
| 14 | I-09 (продолжение): компонентные тесты UI в jsdom + Testing Library (`src/test/setup.ts`, `src/test/fixtures.ts` с маршрутизируемым моком `fetch`): `Feed.test.tsx` (5), `ArticleDrawer.test.tsx` (4), `SettingsPanel.test.tsx` (4) — покрыты пользовательские сценарии, которые раньше проверялись только руками | ✅ |
| 15 | I-05 (частично): белый список журналов расширен с 93 до ~185 записей — смежные Q1 с ЛОР-релевантными РКИ (анестезия, педиатрия, неврология/вестибулология, аллергия, визуализация, онкология головы и шеи), национальные ЛОР-журналы MEDLINE/PMC (в т. ч. «Вестник оториноларингологии», HNO, Braz J Otorhinolaryngol, Acta Otorrinolaringol Esp), аудиология/фониатрия/сон, методологические (Trials, Syst Rev, BMJ EBM). Тест согласованности: один ключ — один tier, у каждой записи есть ISO-аббревиатура. `CLASSIFIER_VERSION = 3` → существующие записи переразмечаются автоматически | ✅ |
| 16 | A-04: Crossref-перепроверка по DOI (`src/lib/sources/crossref.ts`, `recheckEditorialNotices` с вращающимся курсором `crossref_cursor`, 20 DOI/запрос, 200/запуск, откат на одиночные запросы при 400); `editorial_notice` jsonb (миграция 0012); `classify()` учитывает уведомление (retraction/withdrawal → отзыв −60, EoC −25); `planWrites` не «реабилитирует» отозванные при обновлении из источника; бейджи EoC/исправления + ссылка на уведомление в карточке; строка «Crossref: отзывы и EoC» в журнале запуска; `CROSSREF_EMAIL`; OpenAPI `EditorialNotice`. Тесты: фикстура ответа Crossref (парсинг, пачки, откат), PGlite-прогон (флаги, курсор, идемпотентность, пересчёт доверия), регрессия planWrites, бейдж в ленте. Не сделано: push-уведомление о новых отзывах (есть лог `retraction.crossref_notice` и строка журнала) | ✅ |
| 17 | A-06: таксономия издателей руководств `src/lib/evidence/guidelines.ts` (30 органов, паттерны по заголовку/коллективным авторам/журналу/началу аннотации, защита от ложных «nice/who/sign»), колонка `guideline_issuer` (миграция 0013) заполняется классификатором (`CLASSIFIER_VERSION = 4` → существующие руководства доразмечаются), фильтр `issuer=` (+`other`) в `parseFilters`/`buildWhere`, фасет `issuers` в ответе `/api/articles` при `design=guideline`, чипы издателей и бейдж в ленте/карточке, описание в заголовке RSS, OpenAPI. Не сделано: уведомление о новых/обновлённых руководствах (покрывается RSS `?issuer=…`) | ✅ |
| 18 | A-08: `src/lib/trials.ts` (`recheckTrials` — вращающийся курсор `trials_cursor`, 300 NCT/запуск через новый `fetchClinicalTrialsByIds` с `filter.ids` по 100; `diffTrial`/`buildTrialInfo`/`previousTrialState` чистые, старые записи читают статус из сгенерированной аннотации), колонка `trial_info` (миграция 0014), обновление записи свежими данными + переклассификация + `fetched_at` → изменение всплывает в ленте/RSS; `TrialBadge` и блок «Реестр ClinicalTrials.gov» в карточке; строка `trial-tracking` в журнале. Связь по NCT в `planWrites`: публикация занимает «чистую» запись реестра (новый dedupKey, NCT сохранён), повторный реестр — link-only, вторичные публикации — отдельно; исправлен `mergeRaw` (подсказки реестра не классифицировали слитую статью как `trial_registry`). Тесты: адаптер (3), trials (7, PGlite), planWrites (2), mergeRaw (1), интеграционный сценарий из трёх запусков | ✅ |
| 19 | Публичные read-маршруты: `src/lib/public-api.ts` — `conditionalResponse`/`conditionalJson` (слабый ETag по телу, `If-None-Match` с приоритетом над `If-Modified-Since`, 304 с повторёнными валидаторами и `Cache-Control`), `publicRateLimit` (in-memory, ключ сессия → токен → IP, общий бакет ×10 без `TRUST_PROXY`, 429 + `Retry-After`); подключено к `/api/articles`, `/api/articles/:id/related` (теперь ещё и с `apiFailure`), `/feed.xml` (+ `Last-Modified` по `fetched_at`). OpenAPI: ответы 304/429. Гигиена: `npm run check`, `CONTRIBUTING.md`, `.github/PULL_REQUEST_TEMPLATE.md`, формы issue, `.editorconfig` | ✅ |
| 20 | Доступность (a11y): `ArticleDrawer` — `aria-label` с заголовком статьи, `useBodyScrollLock` (overflow + компенсация scrollbar, восстанавливается при закрытии), `role="status" aria-live="polite"` для «Скопировано»/«Сохраняем…», `role="group"` у панели цитирования, `aria-label` у textarea заметок; `Feed` — поиск `type="search"` + `aria-label` (без нативного крестика WebKit), `topics/page` — подписи полей формы. Тест в `ArticleDrawer.test.tsx` | ✅ |
| 21 | `noUncheckedIndexedAccess` (пункт L): `tsconfig.strict.json` (extends базовый, тесты исключены) в `npm run typecheck`/CI; 68 мест в продакшн-коде приведены к безопасному доступу (`Feed` клавиши Enter/b/r при `focusedIdx` вне списка, `e.touches[0]` в swipe/pull-to-refresh, `useFocusTrap`, агрегаты `count(*)` в `page.tsx`/`stats.ts`/`queries.ts`/`refresh.ts`/`diagnostics.ts`, `X-Forwarded-For`/CIDR/сессионный токен, ротация моделей ИИ, парсеры аннотаций/цитат/журналов, курсоры retraction/trials). Решение: не включать флаг для тестов (255 мест `rows[0].x` на непустых фикстурах) | ✅ |
| 22 | Ревизия индексов (пункт J): сопоставлены `buildWhere`/сортировки/поиски по идентификаторам с индексами; добавлены `articles_fetched_at_idx` (сортировка `fetched`, по умолчанию в `/feed.xml`) и `articles_nct_upper_idx` (`upper(nct_id)` для `inArray(upper(nct_id))` в `doRefresh`/`restore`); индексы миграции 0002 (GIN subspecialties/source_keys/topic_ids, study_design, evidence_level) объявлены в `schema.ts`; миграция `0015_indexes_review.sql` с `IF NOT EXISTS`; таблица индексов в ARCHITECTURE §5 | ✅ |
| 23+ | I-03/I-05 (справочник как данные с ISSN)/I-06, A-10, A-15, A-16 | ⏳ |

Оставшиеся уязвимости `npm audit` (9) — только dev-цепочка (`braces` через `eslint-config-next`, `esbuild` через `drizzle-kit`); исправлений без понижения версий этих пакетов нет, в рантайм не попадают.

---

## 0. Резюме для владельца

Проект зрелый для своего размера: чистая архитектура «источник → дедуп → классификация → запись», продуманные детали (DB-лок рефреша, кросс-инстансный rate-limit, CSP с nonce, экранирование в дайджесте, идемпотентный посев, фокус-трапы, Atom-лента), `lint`/`typecheck`/104 unit-теста — зелёные. README подробный.

Но есть **три критических дефекта**, из-за которых проект нельзя считать безопасным для публичного хостинга и надёжным как медицинский инструмент:

1. **`API_SECRET` обходится одним заголовком.** `curl -H "Sec-Fetch-Site: same-origin"` (или `Origin: <host>`) даёт полный доступ к мутирующим эндпоинтам: смена настроек, создание/удаление тем, удаление статей, выгрузка бэкапа с личными заметками, запуск рефреша и платных ИИ-вызовов. Воспроизведено (раздел 2.3). Тест в репозитории закрепляет эту дыру как «ожидаемое поведение».
2. **Автоудаление всей базы PGlite при любой ошибке открытия/миграции** (`fs.rmSync`) — одна неудачная миграция в будущем релизе, диск-full или несовместимость формата после апгрейда PGlite молча уничтожат закладки, заметки и темы.
3. **Повреждение заголовков и аннотаций PubMed со встроенной разметкой** (`<i>`, `<b>`, `<sup>`, `<sub>` — названия видов, генов, степени): парсер склеивает слова и переставляет фрагменты в конец («Role ofbiofilm in chronic rhinosinusitis: areview. Staphylococcus aureus systematic»). Это портит отображение, дедупликацию по заголовку, регулярные выражения классификатора и извлечение размера выборки. Воспроизведено.

Далее по значимости: сборка падает без доступа к Google Fonts (Docker в закрытой сети не соберётся); `POST /api/refresh` держит HTTP-запрос минуты (504 за прокси, «вечно running» на serverless); систематические ошибки классификатора (Cochrane без PT → «нарративный обзор», все Lancet-сабжурналы → Tier 1, сокращённые названия журналов из Europe PMC → Tier 0, ложные бонусы за «registered nurses»/«International Classification»); поиск «ухо» → `%ear%` возвращает почти всю базу; ИИ-эндпоинты принимают произвольный текст и прогреваются на каждую загрузку ленты.

**Оценка по измерениям (1–5):**

| Измерение | Оценка | Обоснование |
|---|---|---|
| D1 Безопасность | **2** | Обход авторизации; остальное (CSP, заголовки, экранирование, rate-limit) сделано хорошо |
| D2 Сохранность данных | **2** | `rmSync` базы; порча текста PubMed; нет восстановления из бэкапа |
| D3 Доменная корректность | **3** | Ядро разумное и протестированное, но есть системные ложные срабатывания и пробелы в tier/дизайнах |
| D4 Надёжность/эксплуатация | **3** | Лок и изоляция источников — хорошо; долгий HTTP-рефреш, зависимость сборки от сети, Docker-права |
| D5 Производительность | **3.5** | Индексы и кэш статистики есть; поиск усиливает нагрузку, 2–3 загрузки на маунт, кэши без вытеснения |
| D6 Код и тесты | **4** | Чистый TS, один `any`; нет тестов адаптеров/API/миграций, один тест закрепляет баг |
| D7 UX/a11y | **4** | Сильная доступность и мобильность; гонка запросов в ленте |
| D8 DX/CI | **3** | CI есть; снапшоты миграций устарели, нет audit/docker-гейтов, метаданные пакета — от шаблона |
| D9 Документация | **4** | Подробно, но README переоценивает защиту `API_SECRET` |
| D10 Продуктовые пробелы | **3** | Нет восстановления бэкапа, переклассификации, алертов, ретракций по DOI |

---

## 1. Что уже сделано хорошо (не сломать при исправлениях)

- Чистое, тестируемое ядро `lib/evidence/*`; `planWrites` вынесен в чистую функцию и покрыт тестами.
- Кросс-инстансный лок рефреша через `settings` с арендой и heartbeat; изоляция сбоев источников; `partial`-статусы.
- Rate-limit с атомарным `INSERT … ON CONFLICT … RETURNING` в БД, fail-open на in-memory.
- Корректная работа с `X-Forwarded-For` (справа налево, CIDR доверенных прокси), сравнение секрета за постоянное время.
- CSP с nonce + `strict-dynamic`, безопасные заголовки, экранирование HTML/XML в дайджесте и Atom, `safeHref`.
- Экранирование `%`/`_` в ILIKE, GIN/trgm-индексы, частичные уникальные индексы по PMID/DOI с миграцией-дедупликацией, сохраняющей пользовательские поля.
- Перепроверка ретракций с «вращающимся» курсором; восстановление зависших `running`-запусков при старте.
- Доступность: skip-link, фокус-трапы, aria, `prefers-reduced-motion`; мобильные листы, pull-to-refresh, горячие клавиши.
- Хорошая документация переменных окружения и режимов деплоя.

---

## 2. Как проводился аудит

### 2.1 Статические проверки

| Команда | Результат |
|---|---|
| `npm ci` | OK (450 пакетов) |
| `npm run lint` | OK, 0 предупреждений |
| `npm run typecheck` | OK |
| `npm test` | OK — 12 файлов, 104 теста |
| `npm run build` | **FAIL** — `next/font: Failed to fetch Inter from Google Fonts` (см. F-04) |
| `npm audit` | 12 уязвимостей (8 high, 4 moderate): `source-map-js` (fix доступен), `postcss ≤8.5.22` (закреплён 8.5.8), `braces/micromatch` через `eslint-config-next`, `esbuild` через `drizzle-kit` — все в dev/build-цепочке (см. F-22) |
| `npm outdated` | PGlite 0.3.16 → 0.5.x, tailwind 4.1 → 4.3, eslint 9 (deprecated) → 10, pg 8.20 → 8.23 и др. |

### 2.2 Динамические проверки (dev-сервер, PGlite in-file)

- `GET /api/health` → 200; `GET /api/status` → 200.
- `GET /api/articles/abc` → **500** (`invalid input syntax for type integer: "NaN"`), ожидалось 400.
- `PATCH /api/settings` с телом `not-json` → **500** (`SyntaxError`), ожидалось 400.
- Заголовки HTML-ответа: `X-Frame-Options: SAMEORIGIN`, HSTS, `Cache-Control: no-store` (из-за `force-dynamic`).

### 2.3 Проверка авторизации (сервер запущен с `API_SECRET=topsecret`)

```
PATCH /api/settings  (без заголовков)                      → 401  ✓
PATCH /api/settings  -H "Sec-Fetch-Site: same-origin"      → 200  ✗ настройки изменены
POST  /api/topics    -H "Origin: http://127.0.0.1:3000"    → 201  ✗ тема создана
GET   /api/backup    -H "Sec-Fetch-Site: same-origin"      → 200  ✗ бэкап с заметками выгружен
```

### 2.4 Доменные пробы (через временный vitest-файл, удалён)

- Парсер PubMed XML на смешанном контенте — порча текста (F-03).
- `classify()` на 12 крафтовых примерах, `journalTier()` на 47 названиях, `expandQuery()` на коротких запросах — результаты в F-06…F-13.

---

## 3. ИСПРАВИТЬ (дефекты)

### Критично

**F-01 · C · D1 · Обход `API_SECRET` через заголовки `Sec-Fetch-Site` / `Origin`**
Где: `src/lib/security.ts:205-223` (`checkApiAuth`), особенно строки 218 и 221; тест `src/lib/security.test.ts` «accepts same-origin via sec-fetch-site even without Origin».
Доказательство: раздел 2.3. `Sec-Fetch-Site` и `Origin` — это защита от *межсайтовых браузерных* запросов (CSRF), а не аутентификация: любой HTTP-клиент выставляет их произвольно; `Host` в не-браузерном запросе тоже контролирует клиент.
Влияние: при публичном хостинге злоумышленник без секрета: меняет настройки и темы, удаляет статьи, выгружает заметки (`/api/backup`, `/api/export`), запускает рефреш (лимит 5/мин общий), гоняет ИИ за ваш счёт (`/api/ai`, `/api/ai/warm`), шлёт дайджест. README обещает обратное.
Рекомендация: (а) убрать «same-origin ⇒ ok» из аутентификации; оставить его **дополнительной** CSRF-проверкой; (б) ввести сессию: страница `/login` принимает `API_SECRET` (или отдельный `ADMIN_PASSWORD`), ставит подписанную HMAC `httpOnly; SameSite=Lax; Secure` cookie; API принимает Bearer **или** валидную cookie + same-origin; (в) если авторизация делегируется reverse-proxy — явный флаг `AUTH_MODE=proxy` и предупреждение в логах при пустом `API_SECRET` в production; (г) переписать тест на «REJECTS spoofed Sec-Fetch-Site without token». Усилие: M.

**F-02 · C · D2 · Автоудаление каталога PGlite при любой ошибке открытия/миграции**
Где: `src/db/index.ts:93-100` — `catch { fs.rmSync(dataDir, { recursive: true, force: true }); … open() }`.
Доказательство: ловится *любое* исключение из `openPglite()` → включая падение миграции (например, будущая `CREATE UNIQUE INDEX` на данных с дублями), `ENOSPC`, несовместимость on-disk формата после обновления `@electric-sql/pglite` (0.3 → 0.5 в `npm outdated`), временную ошибку инициализации WASM.
Влияние: безвозвратная потеря всех статей, закладок, заметок, тем и настроек без подтверждения; в логах — тишина (`catch` без сообщения).
Рекомендация: никогда не удалять: переименовывать в `.pglite.broken-<timestamp>`; восстанавливать только при распознанных ошибках повреждения; перед миграцией делать `writeBackupToFile()` + копию каталога; в `NODE_ENV=production` — fail-fast с понятной ошибкой вместо «самовосстановления»; логировать причину. Усилие: S.

**F-03 · C · D3 · Порча заголовков/аннотаций PubMed со встроенной разметкой**
Где: `src/lib/sources/pubmed.ts:85, 191` (`new XMLParser({...})` без `stopNodes`/`preserveOrder`), `textOf` (`pubmed.ts:46-61`) склеивает `#text` и дочерние теги.
Доказательство (воспроизведено на `fast-xml-parser@5.11.1`):
```
<ArticleTitle>Role of <i>Staphylococcus aureus</i> biofilm in chronic rhinosinusitis: a <b>systematic</b> review.</ArticleTitle>
→ { i: "Staphylococcus aureus", b: "systematic", "#text": "Role ofbiofilm in chronic rhinosinusitis: areview." }
→ textOf: "Role ofbiofilm in chronic rhinosinusitis: areview. Staphylococcus aureus systematic"
<AbstractText>… affects 10<sup>6</sup> people and <i>S. aureus</i> …</AbstractText>
→ "… affects 10people andis implicated. 6 S. aureus"
```
С `stopNodes: ["*.ArticleTitle", "*.AbstractText"]` парсер возвращает сырой inner-XML, который корректно чистится `stripTags()` (проверено).
Влияние: ЛОР-литература насыщена курсивом (микроорганизмы, гены, *in vitro*, *n* = …, p < 0.05, 10<sup>6</sup>). Искажаются заголовки в ленте/экспорте/дайджесте; ломается `normalizeTitle` → дубли; регексы `detectDesign` (например, «a **systematic** review» → слово уезжает в конец строки, но ещё и «areview») и `extractSampleSize` (`<i>n</i> = 120`) дают неверный результат.
Рекомендация: включить `stopNodes` для `ArticleTitle`, `AbstractText`, `CopyrightInformation`, `Keyword`; расширить `stripTags` декодированием `&quot; &apos; &#NNN; &#xHH;`; добавить fixture-тесты на реальных PubMed XML; после фикса — переклассификация/перезаливка затронутых записей (см. A-03). Усилие: S (фикс) + M (перезаливка).

### Высоко

**F-04 · H · D8 · Сборка зависит от fonts.googleapis.com**
Где: `src/app/layout.tsx:10-14` (`Inter` из `next/font/google`), `Dockerfile` (`RUN npm run build`).
Доказательство: `npm run build` → `Error: next/font: Failed to fetch Inter from Google Fonts` (раздел 2.1). В dev — лишь предупреждение с fallback.
Влияние: Docker-образ не собирается в сети без выхода к Google (корпоративные сети, РФ без VPN — тот самый сценарий из `.env.example`), CI вне GitHub, air-gapped. Невоспроизводимая сборка.
Рекомендация: `next/font/local` с `Inter` woff2 (latin+cyrillic) в `public/fonts` или системный стек (`font-family: system-ui, …`). Усилие: S.

**F-05 · H · D4 · Рефреш выполняется внутри HTTP-запроса**
Где: `src/app/api/refresh/route.ts:26` (`await runRefreshSafe("manual")`, `maxDuration = 300`), `src/components/RefreshButton.tsx:33-49`.
Доказательство: 14 тем × (esearch + efetch ×N) с троттлом 400 мс + параллельные источники + перепроверка ретракций до 25 efetch-пачек → типично 1–5 минут. Nginx/Cloudflare/Traefik обрывают запрос через 60–100 с → клиент получает 504, `RefreshButton` в `finally` ставит `running=false`, останавливает опрос и позволяет нажать снова (→ 409). На serverless при превышении `maxDuration` (300 с; на бесплатных планах лимит обычно ниже — ⚠ зависит от провайдера) функция убивается, запись `fetch_runs` остаётся `running` навсегда: stale-recovery живёт только в `instrumentation.ts:43`, которого на serverless нет (README это признаёт).
Влияние: ложные «ошибки» и «вечно выполняется», невозможность понять, завершился ли рефреш; на serverless — неполные данные без следа.
Рекомендация: `POST /api/refresh` → немедленно `202 {runId}`; выполнение в фоне (`after()` из `next/server`, либо отдельный воркер-процесс `npm run worker`, либо pg-очередь); UI/cron опрашивают `GET /api/runs/:id`; stale-recovery перенести в начало `runRefresh` (не только при старте процесса); стрим прогресса по источникам (SSE) как улучшение. Усилие: M.

**F-06 · H · D3 · Cochrane-обзоры без PT «Systematic Review» классифицируются как нарративный обзор**
Где: `src/lib/evidence/classify.ts:43-104` (`detectDesign`) — журнал не используется как признак.
Доказательство (проба): `journal: "Cochrane Database Syst Rev", publicationTypes: ["Review","Journal Article"], title: "Antibiotics for acute otitis media in children"` → `design=narrative, level=5, trust=46`. Тип публикации в PubMed проставляется при индексации с задержкой, а запрос темы «Cochrane: ЛОР-обзоры» использует `datetype=edat`, то есть забирает записи *до* индексации.
Влияние: самые ценные записи получают уровень 5 и теряются в ленте «уровень 1».
Рекомендация: правило «журнал ∈ {CDSR} ⇒ systematic_review»; аналогично «Cochrane protocol» → `protocol`; добавить тесты. Усилие: S.

**F-07 · H · D3 · Журнальные tier: сверх-включение Lancet и слепота к ISO-аббревиатурам**
Где: `src/lib/evidence/journals.ts:13` (`lancet\b(?!.*(?:planetary|psychiatry|global|infectious))`), `:39` (`/lancet oncology/` в Tier 2 — мёртвый код), весь список — только полные названия.
Доказательство (проба): `Lancet Oncology/Respiratory/Neurology/Regional Health → 1`; `Otol Neurotol → 0`, `Clin Otolaryngol → 0`, `Int Forum Allergy Rhinol → 0`, `The BMJ → 0`, `JAMA Surgery → 0`; `Oral Oncology` продублирован в Tier 2 и 3. Europe PMC отдаёт в `journalTitle` **сокращённое** название (`"Otol Neurotol"`), поэтому записи, пришедшие только из Europe PMC, систематически получают Tier 0 (4 балла вместо 26).
Влияние: систематическое смещение индекса доверия в зависимости от источника, а не журнала.
Рекомендация: заменить regex-список на таблицу `{title, isoAbbrev, issn[], tier, since}`; матчить в первую очередь по ISSN (PubMed XML: `Journal/ISSN`; Europe PMC: `journalInfo.journal.issn`), затем по нормализованному названию; убрать дубли; покрыть тестами полные и сокращённые формы. Усилие: M.

**F-08 · H · D1/D5 · ИИ-эндпоинты принимают произвольный текст и прогреваются на каждую загрузку ленты**
Где: `src/app/api/ai/route.ts` (text до 30 000 симв.), `src/app/api/ai/warm/route.ts:39` (`warmAbstracts(texts.slice(0,50))`), `src/lib/ai.ts:279` (4 воркера на вызов, без глобального лимита), `src/components/Feed.tsx:213` (warm на каждый `load`).
Доказательство: клиент отправляет любой текст → сервер оплачивает перевод/резюме (в связке с F-01 — любой аноним). Каждая смена фильтра/страницы → до 30 переводов «на всякий случай»; на маунте `load` срабатывает 2–3 раза (см. F-19) → 2–3 warm-вызова. Лимиты 20 вызовов/мин × 4 воркера → до 80 параллельных LLM-запросов с одного «unknown»-IP.
Влияние: неконтролируемые расходы при платной модели, исчерпание квот бесплатных, деградация латентности для реального запроса пользователя.
Рекомендация: API принимает `articleId` (+ `action`), текст берётся из БД; прогрев — только по явному действию пользователя или для открытой карточки (+1–2 соседних); глобальный семафор (например, 2–3 одновременных вызова на процесс) и дневной бюджет токенов/вызовов в `settings`; счётчик расхода в `/stats`. Усилие: M.

**F-09 · H · D3/D5 · Поиск: короткие термы и подстрочный ILIKE дают почти всю базу**
Где: `src/lib/queries.ts:9-15` (`%term%` по title/abstract/journal/authors), `src/lib/search.ts:305` (токены длиной ≥2).
Доказательство (проба): `expandQuery("ухо") → [["ухо","ear"]]` → `ILIKE '%ear%'` совпадает с *year, research, hearing, early, clear, wear*. Двухсимвольные токены (`ct`, `ci`) не используют trgm-индекс (нужно ≥3 символа) → seq scan.
Влияние: нерелевантная выдача по частым русским запросам; усиление нагрузки (до 12 групп × 16 термов × 4 колонки ILIKE).
Рекомендация: полнотекстовый поиск — колонка `search_tsv` (`to_tsvector('english', title || abstract || journal || authors)`) + GIN + `websearch_to_tsquery`, синонимы как OR внутри группы; для термов короче 5 символов — границы слов (`~* '\mear\M'`) вместо `%ear%`; минимальная длина токена 3; показать «по каким термам искали». Усилие: M.

**F-10 · H · D6 · 500 вместо 400 при невалидных входных данных**
Где: `src/app/api/articles/[id]/route.ts:10-13, 23, 40`, `src/app/api/topics/[id]/route.ts:23, 35` (`Number(id)` без проверки), `req.json()` без `try` в `settings`, `topics`, `topics/[id]`, `sources/[key]`, `articles/[id]`.
Доказательство: раздел 2.2.
Влияние: шум в логах/мониторинге, невозможность отличить ошибку клиента от сбоя сервера, подсказка о внутренностях (стек в dev).
Рекомендация: общие хелперы `parseId()` и `readJson(schema)` на zod; единый формат ошибок `{error, code}`; `DELETE` несуществующего → 404. Усилие: S.

### Средне

**F-11 · M · D3 · Ложные бонусы доверия «регистрация протокола» и «многоцентровое»**
Где: `classify.ts:248` (`…|registered/i`), `:269` (`…|international/i`).
Доказательство: «Hearing screening by **registered** nurses» → +6; «Using **International** Classification of Diseases codes» → +3.
Рекомендация: `registered (prospectively|with|in|at|on)|trial registration|registration number|PROSPERO|CRD\d+|NCT\d{8}|ISRCTN\d+|ChiCTR|DRKS`; `multicent(er|re)|multinational|\b\d+ (centers|centres|sites|hospitals|countries)\b`. Усилие: S.

**F-12 · M · D3 · Ложные субспециальности: «adenoid» → детская ЛОР, «immunotherapy» → онкология**
Где: `taxonomy.ts:64` (`/\badenoid/`), `:55` (`/immunotherapy/`).
Доказательство: «Adenoid cystic carcinoma of the parotid» → `pediatric`; «Sublingual immunotherapy for allergic rhinitis» → `head_neck_oncology`.
Рекомендация: `\badenoid(s|al|ectomy| hypertrophy| vegetation)\b(?! cystic)`; в онкологии — `(cancer |checkpoint |immune )immunotherapy|pembrolizumab|nivolumab|cemiplimab`; добавить негативные паттерны и «уверенность» метки. Усилие: S.

**F-13 · M · D3 · Вторичные/post-hoc анализы РКИ получают дизайн «РКИ» и уровень 2**
Где: `classify.ts:94` (любое «randomized» в заголовке ⇒ rct).
Доказательство: «Secondary analysis of the XYZ randomized trial» → `rct, level 2`.
Рекомендация: при `secondary analysis|post[- ]hoc|exploratory|subgroup analysis|long-term follow-up of` понижать до `cohort` с пометкой «вторичный анализ РКИ»; «Mendelian randomization» → отдельный дизайн или `cohort`, но не `other`. Усилие: S.

**F-14 · M · D3 · medRxiv: просматривается лишь часть окна**
Где: `src/lib/sources/medrxiv.ts:35` (`page < 12` × 100 записей).
Доказательство: эндпоинт `details/medrxiv/{from}/{to}` отдаёт **все** препринты всех категорий по 100 на страницу, фильтрация по ЛОР выполняется на нашей стороне. При ~1000–1500 препринтов в месяц (⚠ оценка, проверить по `messages[0].total` онлайн) потолок в 1200 записей находится на грани 30-дневного окна, а при большем `lookbackDays` или всплеске публикаций хвост окна молча отбрасывается; в журнал запуска пишется только число найденных, факт усечения не фиксируется.
Рекомендация: ⚠ проверить онлайн параметр фильтра категории у API; иначе итерировать по дням/до `total` с лимитом времени; писать «просмотрено X из total» в детали запуска и помечать запуск `partial` при усечении. Усилие: S.

**F-15 · M · D4/D5 · Перепроверка ретракций тянет полный XML до 5000 записей за запуск**
Где: `src/lib/retraction.ts:21` (`MAX_PER_RUN = 5000`), `pubmed.ts:187-214` (efetch по 200).
Доказательство: 25 efetch-запросов полных записей (мегабайты) ради одного поля `PublicationType`; с троттлом 400 мс + латентностью — минуты на каждый рефреш, при этом удерживается общий троттл NCBI.
Рекомендация: `epost` списка PMID в History → `esearch term=#1 AND "Retracted Publication"[pt]` (один лёгкий запрос на пачку), либо `esummary` (JSON, поле `pubtype`); для записей без PMID (medRxiv, Europe PMC PPR) — Crossref `update-to`/Retraction Watch по DOI (см. A-04). Усилие: S–M.

**F-16 · M · D8 · Миграции Drizzle: устаревшие снапшоты и захардкоженный DSN**
Где: `drizzle/meta/` — снапшоты только `0000`, `0001`; `drizzle.config.json` — `postgresql://postgres:postgres@127.0.0.1:5432/app_db`.
Доказательство: `schema.ts` содержит `rate_limits` и частичные уникальные индексы, последний снапшот — нет → `npm run db:generate` сгенерирует миграцию, повторно создающую их (без `IF NOT EXISTS`) и упадёт на существующих БД.
Рекомендация: пересобрать снапшоты (`drizzle-kit generate` после ручного выравнивания или `drizzle-kit up`), перейти на `drizzle.config.ts` с `process.env.DATABASE_URL`, добавить `db:migrate` и `db:check` в CI. Усилие: S.

**F-17 · M · D4 · Docker: права на bind-mount и отсутствие HEALTHCHECK в образе**
Где: `Dockerfile:25` (`adduser -S app` — непредсказуемый системный UID), `docker-compose.yml` (`./docker-data`, `./backups` — bind-mount с правами хоста).
Доказательство: каталоги на хосте создаются от root/1000, процесс в контейнере — другой UID → `EACCES` при создании `.pglite`/бэкапа при первом запуске на чистой машине. `HEALTHCHECK` только в compose (README говорит про образ).
Рекомендация: `adduser -u 1001 -S app -G app`, документировать `chown -R 1001:1001 docker-data backups` или использовать named volumes; добавить `HEALTHCHECK` в Dockerfile. Усилие: S.

**F-18 · M · D4 · Статус источника PubMed «ok», если упали не все темы**
Где: `src/lib/refresh.ts:266` (`errors.length < enabledTopics.length`).
Влияние: `/api/status` показывает «здоров», когда 13 из 14 тем упали; алертить не на что.
Рекомендация: статус `degraded` при ≥1 ошибке, хранить `failedTopics/totalTopics`; в UI — жёлтый индикатор. Усилие: S.

**F-19 · M · D7 · Гонка запросов и тройная загрузка ленты на маунте**
Где: `src/components/Feed.tsx:200-224` (`load` без AbortController/sequence), `:183-199` (восстановление из URL создаёт новый объект фильтров → повторный `load`; debounce `q` → ещё один).
Влияние: при быстром наборе более ранний медленный ответ перетирает актуальный; на каждый маунт 2–3 запроса `/api/articles` и столько же warm-вызовов.
Рекомендация: AbortController в эффекте (или `useSWR`/TanStack Query с ключом фильтров), сравнение значений фильтров перед `setF`, отложить первый `load` до восстановления из URL. Усилие: S.

**F-20 · M · D1 · CSV без защиты от формул**
Где: `src/app/api/export/route.ts:8` (`csvEscape`).
Влияние: заголовок/автор из внешнего источника, начинающийся с `=`, `+`, `-`, `@`, исполняется в Excel/LibreOffice как формула.
Рекомендация: префикс `'` (или `\t`) для ячеек, начинающихся с этих символов. Усилие: S.

**F-21 · M · D1 · Дайджест раскрывает адреса всех получателей**
Где: `src/lib/mailer.ts:64` (`to: to.join(", ")`).
Рекомендация: `bcc` или отправка по одному; `to` — служебный адрес. Усилие: S.

**F-22 · M · D1/D8 · Уязвимые/устаревшие зависимости**
Доказательство: `npm audit` — `source-map-js` (high, `npm audit fix`), `postcss 8.5.8` (закреплён, high, нужно ≥8.5.30), `braces/micromatch` (через `eslint-config-next`), `esbuild` (через `drizzle-kit`); `eslint@9.39.4` помечен deprecated. Все — сборочная цепочка, не рантайм, но блокируют «чистый» CI и Dependabot.
Рекомендация: `npm audit fix`, поднять `postcss`, `eslint`/`eslint-config-next`, PGlite 0.3 → 0.5 (⚠ проверить совместимость формата данных — связано с F-02), включить Dependabot/Renovate. Усилие: S–M.

**F-23 · M · D4 · Общий таймаут стрима ИИ обрывает длинные ответы**
Где: `src/lib/ai.ts:112` (`setTimeout(() => ctrl.abort(), timeoutMs)` на весь поток, 30 с).
Влияние: длинная структурированная аннотация на медленной бесплатной модели обрывается на полуслове; переключение на следующую модель после первого чанка сознательно отключено (`aiStream`, чтобы не смешивать ответы) — поэтому фиксированный общий таймаут здесь особенно вреден.
Рекомендация: idle-timeout (сброс на каждом чанке, 20 с) + общий потолок 120 с; при обрыве — пометка «ответ усечён». Усилие: S.

**F-24 · M · D5 · Кэши без вытеснения**
Где: `src/lib/ai.ts:35-41` (`__aiCache` Map без лимита), таблица `ai_cache` без TTL/очистки.
Рекомендация: LRU на ≤500 записей в памяти; периодическая очистка `ai_cache` старше N месяцев или по размеру; ключ кэша включать версию промпта/модель. Усилие: S.

### Низко

**F-25 · L · D8** — `package.json`: `name: "nextjs-postgresql-template"`, нет `engines`, поле `allowScripts` не является полем npm, `dotenv` в dependencies не используется. Усилие: S.
**F-26 · L · D1** — Противоречие `frame-ancestors 'none'` (`proxy.ts:37`) и `X-Frame-Options: SAMEORIGIN` (`next.config.ts:17`). Выбрать одно. Усилие: S.
**F-27 · L · D9** — Atom-лента без `<author>` (обязателен по RFC 4287, если нет у записей); `urn:doi:` — незарегистрированная URN-схема, лучше `https://doi.org/<doi>` в `<id>`. Усилие: S.
**F-28 · L · D1** — `/api/status` публично отдаёт `lastError` с внутренними деталями (`status/route.ts:38`); `GET /api/digest` (`digest/route.ts:16`) без авторизации собирает и отдаёт полный дайджест (HTML+данные) — лишняя нагрузка и утечка состава ленты при публичном хостинге. Усилие: S.
**F-29 · L · D6** — Нет ограничений длины `name`/`query` темы (запрос уходит в URL NCBI без лимита), `PATCH` допускает пустые значения; удаление темы оставляет «висячие» `topicIds` в статьях. Усилие: S.
**F-30 · L · D7** — `SettingsPanel.saveCfg` не проверяет `r.ok` (`SettingsPanel.tsx:45`): при 401/500 состояние становится `{error}` и форма ломается. Усилие: S.
**F-31 · L · D7** — Дайджест выводит сырые ключи (`systematic_review — 5`, `countLabel` в `digest.ts:101`) вместо русских лейблов. Усилие: S.
**F-32 · L · D4** — `fetchWithRetry` (`http.ts:34`): при 429 от NCBI пауза 0.8–1.6 с, `Retry-After` игнорируется; `throttle` (`http.ts:4`) не защищён от конкурентных вызовов (возможен burst). Усилие: S.
**F-33 · L · D3** — `extractSampleSize` отбрасывает любые `n` в 2019–2099 как «год» (`classify.ts:146`) — реальная выборка 2020 теряется; «Retraction of Publication» (уведомление) попадает в классификацию как `other` вместо пропуска. Усилие: S.
**F-34 · L · D9** — README: «мутирующие эндпоинты требуют токен **либо** same-origin» — формулировка скрывает, что это не защита (F-01); «healthcheck в образе» — только в compose (F-17); `drizzle.config.json` упомянут как совместимый с `DATABASE_URL` — он захардкожен (F-16). Усилие: S.

---

## 4. УЛУЧШИТЬ (архитектурные и качественные слабости)

**I-01 · Фоновые задания вместо долгих HTTP-запросов.** Очередь в PG (таблица `jobs`) или отдельный воркер; прогресс по источникам в реальном времени (SSE на `/api/runs/:id/stream`); единый механизм для рефреша, перепроверки ретракций, дайджеста, прогрева ИИ, бэкапа. Закрывает F-05/F-08/F-15 системно.

**I-02 · Полнотекстовый поиск.** `tsvector` + `websearch_to_tsquery` + `ts_rank`, подсветка совпадений, синонимы как OR-группы, фильтр «искать только в заголовке». Закрывает F-09.

**I-03 · Слоистый классификатор с уверенностью.** Порядок признаков: PT PubMed → журнал/издатель (CDSR, AAO-HNS, NICE, EPOS) → заголовок → аннотация; результат с `confidence` и объяснением «почему»; новые дизайны: `protocol`, `diagnostic_accuracy`, `qualitative`, `economic`, `mendelian_randomization`, `secondary_analysis`. Веса и регексы — в данных (JSON), не в коде.

**I-04 · Версионирование формулы доверия и переклассификация.** Хранить `classifierVersion` в статье; команда/эндпоинт «переклассифицировать базу» без повторного скачивания. Сейчас любое исправление F-06…F-13 не затронет уже сохранённые записи (обновляются только те, что снова попали в 30-дневное окно).

**I-05 · Журнальный справочник как данные.** Таблица/JSON `{title, isoAbbrev, issn, tier, quartile, source, reviewedAt}`; предаторские признаки — не по названию журнала (там нет издателя), а по отсутствию MEDLINE/DOAJ-индексации и спискам DOI-префиксов. Честно отразить в README, что текущая «детекция хищнических издательств» практически не срабатывает на данных PubMed.

**I-06 · Europe PMC по темам.** Сейчас запрос захардкожен и не связан с темами; либо строить его из тем (трансляция PubMed-синтаксиса в Europe PMC), либо явно назвать «страховочным каналом» в UI/README.

**I-07 · Единый слой валидации и ошибок.** zod-схемы для всех тел/параметров, `requestId`, структурированные логи (pino) вместо 12 `console.*`, карта ошибок → HTTP-коды.

**I-08 · Наблюдаемость.** `/api/health` → `{db, dbKind, lastRunAt, lastRunStatus, schedulerAlive, lockHolder, version}`; алерт (email/webhook/Telegram) при N подряд неуспешных запусков или отсутствии запусков > 2× интервала; счётчики вызовов NCBI/ИИ.

**I-09 · Тесты.** Fixture-тесты адаптеров на реальных ответах PubMed XML (со смешанным контентом), Europe PMC, CT.gov, medRxiv; интеграционные тесты API на PGlite in-memory (auth, валидация, лимиты); тест миграций 0000→0005 на снапшоте с дублями; e2e (Playwright) для «открыть статью → пометить → экспорт»; coverage-гейт для `src/lib/**`.

**I-10 · CI-гейты.** `npm audit --omit=dev --audit-level=high`, `docker build`, `drizzle-kit check`, Dependabot/Renovate, CodeQL, кэш `.next/cache`.

**I-11 · Производительность страниц.** Главная делает 4 запроса на каждый рендер (`force-dynamic`); вынести агрегаты в тот же TTL-кэш, что и статистика; `count(*)` на каждый список — кэшировать по хэшу фильтров на 30 с.

**I-12 · Rate-limit без `TRUST_PROXY`.** Все клиенты попадают в один бакет `unknown` → один пользователь исчерпывает лимиты для всех (5 рефрешей/мин, 30 ИИ/мин). Для публичного хостинга — требовать `TRUST_PROXY` или использовать сессионную cookie как ключ лимита.

**I-13 · Дедупликация.** Нормализация DOI (`trim`, `lower`, срез `https://doi.org/`, `doi:`), PMID без ведущих нулей, для записей без идентификаторов — `title + год`; слияние двух записей в одной пачке, попавших в одну и ту же существующую строку разными путями (`refresh.ts:193` — второй `toUpdate` затирает merge первого).

**I-14 · UX.** Сохраняемые пользовательские пресеты фильтров; «показать ещё»/бесконечная прокрутка; «отметить страницу прочитанной»; индикатор «почему статья в ленте» (тема/источник — данные уже есть); отображение дат с учётом часового пояса; формат цитаты Vancouver/ГОСТ Р 7.0.5.

**I-15 · Миграции в эксплуатации.** Отдельная команда `db:migrate` (а не на каждом старте каждого инстанса), advisory lock на миграцию, бэкап перед миграцией.

**I-16 · Документация.** `ARCHITECTURE.md` (схема потока, где живут локи/кэши), `SECURITY.md` (модель угроз, что считается безопасным деплоем), ADR для PGlite vs PostgreSQL, формулы доверия и лока в `settings`; CHANGELOG; исправить README по F-34.

---

## 5. ДОБАВИТЬ (отсутствующие возможности)

**A-01 · Аутентификация сессией** (вход по `API_SECRET`/паролю → httpOnly cookie; выход; индикатор «режим только чтение» без входа). Предпосылка для публичного хостинга. *Связано с F-01.*

**A-02 · Восстановление из бэкапа и ротация.** `POST /api/backup/restore` (сопоставление по PMID/DOI/NCT, слияние заметок, импорт тем/настроек); бэкапы `user_backup_<date>.json` с хранением N последних; автоматический бэкап по расписанию и перед миграцией. Сейчас есть только экспорт — бэкап без восстановления не является бэкапом.

**A-03 · Переклассификация и перезаливка.** `POST /api/admin/reclassify` (все/по фильтру), `POST /api/admin/refetch?pmids=` для исправления уже испорченных текстов (F-03); поле `classifierVersion`.

**A-04 · Ретракции по DOI (Crossref/Retraction Watch) и Expression of Concern.** Для препринтов и Europe PMC-записей без PMID; отдельная плашка «Expression of concern»; журнал новых ретракций с уведомлением.

**A-05 · Связь препринт ↔ журнальная публикация.** medRxiv уже отдаёт `published` DOI — хранить `publishedDoi`, показывать «опубликовано в журнале», схлопывать с рецензированной версией и переносить заметки.

**A-06 · Раздел «Руководства».** Отдельная вкладка с фильтром по органу-издателю (AAO-HNS, NICE, EPOS/EUFOREA, ESPO, WHO, IFOS), таксономия издателей, уведомление о новых/обновлённых руководствах.

**A-07 · Алерты вне открытой вкладки.** Правила («уровень 1 и доверие ≥80 по ринологии») → email/Telegram/web-push; сейчас только `Notification API` при открытой странице.

**A-08 · Отслеживание изменений КИ.** Для сохранённых NCT — смена статуса (completed/terminated), появление результатов, публикация по NCT; сейчас забираются только новые регистрации.

**A-09 · Подписки и персональный дайджест через UI.** Получатели, периодичность, фильтры дайджеста — в настройках, а не в env; предпросмотр письма.

**A-10 · Структурированное PICO.** Хранить результат ИИ-резюме как поля (P/I/C/O, n, главный исход) → фильтры «по вмешательству», сравнение исследований; отметка «сгенерировано ИИ».

**A-11 · Ручные переопределения.** «Это не ЛОР / скрыть», коррекция дизайна/субспециальности, защищённая от перетирания при рефреше (сейчас `planWrites` перезаписывает все классификационные поля); накопленные правки — набор данных для калибровки классификатора.

**A-12 · Страница диагностики для администратора.** Держатель лока и срок аренды (кнопка «снять»), курсор перепроверки ретракций, размер БД, последние ошибки по источникам, расход ИИ/NCBI, версия и коммит.

**A-13 · Экспорт BibTeX и копирование цитаты** в Vancouver/ГОСТ; «отправить в Zotero» через RIS уже есть — добавить BibTeX и формат ссылки с PMID/DOI.

**A-14 · OpenAPI-спецификация и `/api/v1`.** Внешний cron и интеграции сейчас опираются на недокументированные контракты.

**A-15 · PWA-офлайн.** Манифест есть, service worker нет: кэш последней ленты и открытых карточек для чтения без сети.

**A-16 · i18n (RU/EN)** и выбор формата дат; интерфейс хардкодит русский.

---

## 6. Roadmap

**Спринт 0 — «стоп-кран» (1–2 дня).**
F-01 (убрать same-origin из аутентификации + тест), F-02 (не удалять БД), F-03 (stopNodes + stripTags + fixture-тест), F-10 (валидация id/JSON), F-22 (`npm audit fix`, postcss), F-34 (README).

**Спринт 1 — корректность и воспроизводимость (1 неделя).**
F-04 (локальный шрифт), F-06/F-07/F-11/F-12/F-13 (классификатор и tier, с тестами), I-04 + A-03 (версия классификатора и переклассификация — **после** фиксов классификатора, чтобы применить их к базе), F-18, F-19, F-20, F-21.

**Спринт 2 — эксплуатация (1–2 недели).**
F-05 + I-01 (фоновый рефреш, 202 + опрос, прогресс), F-08 (ИИ по `articleId`, бюджет, семафор), F-15 + A-04 (лёгкая перепроверка ретракций + Crossref), F-14, F-16, F-17, F-23, F-24, I-07, I-08, I-10, A-02 (восстановление бэкапа), A-01 (сессия).

**Спринт 3+ — качество и продукт.**
F-09 + I-02 (полнотекстовый поиск), I-03/I-05/I-06, I-09 (тесты адаптеров/API/e2e), I-11–I-16, A-05…A-16 по приоритету пользователей.

Зависимости: A-03 после F-03/F-06…F-13; A-01 вместе с F-01; I-01 раньше A-07/A-09 (алерты и дайджест — те же фоновые задания); F-16 раньше любых новых миграций.

---

## 7. Приложения

### 7.1 Команды воспроизведения

```bash
# Статика
npm ci && npm run lint && npm run typecheck && npm test && npm run build && npm audit

# Невалидный вход → 500 (ожидается 400)
curl -i http://127.0.0.1:3000/api/articles/abc
curl -i -X PATCH -H 'Content-Type: application/json' --data 'not-json' http://127.0.0.1:3000/api/settings

# Обход API_SECRET (сервер запущен с API_SECRET=topsecret)
curl -i -X PATCH -H 'Sec-Fetch-Site: same-origin' -H 'Content-Type: application/json' \
  --data '{"lookbackDays":45}' http://127.0.0.1:3000/api/settings          # 200
curl -i -X POST -H 'Origin: http://127.0.0.1:3000' -H 'Content-Type: application/json' \
  --data '{"name":"x","query":"y"}' http://127.0.0.1:3000/api/topics       # 201
curl -i -H 'Sec-Fetch-Site: same-origin' http://127.0.0.1:3000/api/backup  # 200

# Порча XML (node, fast-xml-parser 5.11.1)
node -e 'const {XMLParser}=require("fast-xml-parser");const p=new XMLParser({ignoreAttributes:false,attributeNamePrefix:"@_",textNodeName:"#text"});console.log(JSON.stringify(p.parse("<ArticleTitle>Role of <i>Staphylococcus aureus</i> biofilm: a <b>systematic</b> review.</ArticleTitle>")))'
```

### 7.2 Проверенные файлы
Все `src/**` (app, api-роуты, components, db, lib, lib/evidence, lib/sources, instrumentation, proxy), `drizzle/**`, `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.github/workflows/*`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.mts`, `drizzle.config.json`, `package.json`, `.env.example`, `README.md`, `docs/MEGA_PROMPT.md`.

### 7.3 Помечено «⚠ проверить онлайн»
- Параметр фильтра категории у medRxiv API (F-14).
- Доступность моделей по умолчанию `minimax/minimax-m2.7:free` и др. на OpenRouter (`ai.ts`, `.env.example`).
- Совместимость on-disk формата PGlite 0.3.x → 0.5.x (F-02/F-22).
- Текущее поведение фильтра `humans[filter]` для ещё не проиндексированных записей (`defaults.ts:10`) — влияет на полноту свежих статей.
