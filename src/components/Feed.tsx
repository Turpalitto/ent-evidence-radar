"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Article, Topic } from "@/db/schema";
import { INTL_LOCALE, msg } from "@/lib/i18n";
import { citeGost } from "@/lib/citation";
import { useI18n } from "@/lib/i18n/client";
import { ArticleDrawer } from "./ArticleDrawer";
import { useFocusTrap } from "./useFocusTrap";
import { ArticleCard } from "./feed/ArticleCard";
import { FilterSidebar } from "./feed/FilterSidebar";
import { ShortcutsModal } from "./feed/ShortcutsModal";
import { useNotificationPermission, useOnlineStatus } from "./feed/hooks";
import { IconBell, IconCheck, IconCheckDouble, IconCopy } from "./icons";
import {
  INITIAL_FILTERS,
  PAGE_SIZE,
  SCOPES,
  USER_PRESETS_MAX,
  USER_PRESET_NAME_MAX,
  countActiveFilters,
  feedLink,
  loadUserPresets,
  parseUrlSearch,
  persistUserPresets,
  sameFilters,
  toParams,
  type Filters,
  type UserPreset,
} from "./feed/filters";

const GHOST_BTN = "btn-ghost rounded-xl px-3 py-2.5 text-sm font-medium";
const SCOPE_LABEL: Record<Filters["scope"], string> = { all: msg("Везде"), title: msg("В заголовке"), notes: msg("В моих заметках") };

interface FeedData {
  items: Article[];
  total: number;
  searchTerms: string[];
  issuers: { key: string; count: number }[];
}
const EMPTY: FeedData = { items: [], total: 0, searchTerms: [], issuers: [] };

/**
 * Лента публикаций: фильтры (десктоп — колонка, мобила — нижний лист), поиск с дебаунсом,
 * синхронизация состояния с URL, клавиатурная навигация, pull-to-refresh, офлайн-баннер (A-15),
 * уведомления о статьях 1-го уровня. Разметка карточки — `feed/ArticleCard`, панель — `feed/FilterSidebar`,
 * чистая логика фильтров — `feed/filters`.
 */
export function Feed({ topics }: { topics: Topic[] }) {
  const { t, locale, number } = useI18n();
  const formatCachedAt = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return t("ранее");
    return d.toLocaleString(INTL_LOCALE[locale], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  };
  // Названия встроенных тем есть в словаре; пользовательские t() возвращает как есть.
  const topicNameById = useMemo(() => new Map(topics.map((tp) => [tp.id, t(tp.name)])), [topics, t]);
  /** «Почему статья в ленте»: названия тем, по запросам которых она пришла (I-14). */
  const topicNames = (a: Article) => {
    const names = (a.topicIds ?? []).map((id) => topicNameById.get(id)).filter((x): x is string => !!x);
    if (!names.length) return "";
    return names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
  };
  const [f, setF] = useState<Filters>(INITIAL_FILTERS);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<FeedData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Article | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  /**
   * Каскадное появление карточек — только для первой загрузки (V-08). При смене фильтра
   * лента подменяется целиком, и повторная анимация каждый раз «дёргала» список.
   */
  const [animateIn, setAnimateIn] = useState(true);

  // Pull-to-refresh
  const [ptrActive, setPtrActive] = useState(false);
  const ptrStartY = useRef(0);
  const ptrTriggered = useRef(false);

  const listRef = useRef<HTMLUListElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  const aiConfiguredRef = useRef<boolean | null>(null);
  const notifyPerm = useNotificationPermission();

  // Удержание фокуса в открытом мобильном листе фильтров + возврат фокуса при закрытии.
  useFocusTrap(filtersRef, showFilters);

  useEffect(() => {
    fetch("/api/ai")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { configured?: boolean }) => {
        aiConfiguredRef.current = !!d.configured;
      })
      .catch(() => {
        aiConfiguredRef.current = false;
      });
  }, []);

  // Прогрев переводов — только для открытой карточки и двух следующих в списке (аудит F-08).
  // Раньше прогревалась вся страница ленты на каждую смену фильтра — до 30 переводов «на всякий случай».
  const warmedRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!selected || aiConfiguredRef.current === false) return;
    const idx = data.items.findIndex((a) => a.id === selected.id);
    const ids = [selected.id, ...(idx >= 0 ? data.items.slice(idx + 1, idx + 3).map((a) => a.id) : [])].filter((id) => !warmedRef.current.has(id));
    if (!ids.length) return;
    for (const id of ids) warmedRef.current.add(id);
    void fetch("/api/ai/warm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articleIds: ids }),
    }).catch(() => {});
  }, [selected, data.items]);

  const requestNotification = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const p = await Notification.requestPermission();
    if (p === "granted") {
      new Notification("ENT Evidence Radar", {
        body: t("Уведомления включены: вы получите оповещение при появлении публикаций 1-го уровня доказательности с доверием ≥80."),
      });
    }
  };

  // Восстанавливаем фильтры/поиск/страницу из URL после монтирования (детерминированный первый рендер).
  // Первый запрос ленты откладываем до восстановления, иначе на маунте уходило 2–3 запроса
  // (initial → восстановленные из URL → debounce поиска) и столько же warm-вызовов AI.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      const parsed = parseUrlSearch();
      setF((prev) => (sameFilters(prev, parsed.f) ? prev : parsed.f));
      setQ(parsed.q);
      setPage(parsed.page);
      setRestored(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // Не создаём новый объект фильтров, если строка поиска фактически не изменилась.
    const timer = setTimeout(() => setF((s) => (s.q === q ? s : { ...s, q })), 200);
    return () => clearTimeout(timer);
  }, [q]);

  // Защита от гонки: при смене фильтров предыдущий запрос отменяется, а его поздний
  // ответ не может перетереть актуальные данные.
  const loadAbortRef = useRef<AbortController | null>(null);
  // Офлайн-режим (A-15): ответ, который service worker достал из кэша, несёт x-sw-cache/x-sw-cached-at.
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const online = useOnlineStatus();
  const load = useCallback(async () => {
    loadAbortRef.current?.abort();
    const ctrl = new AbortController();
    loadAbortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      // no-cache (а не no-store): браузер шлёт If-None-Match и получает 304 без тела, если лента не изменилась.
      const r = await fetch(`/api/articles?${toParams(f, page, PAGE_SIZE)}`, { cache: "no-cache", signal: ctrl.signal });
      if (!r.ok) throw new Error(t("Ошибка сервера {status}", { status: r.status }));
      const parsed = (await r.json()) as Partial<FeedData>;
      if (ctrl.signal.aborted) return;
      setCachedAt(r.headers.get("x-sw-cache") === "hit" ? (r.headers.get("x-sw-cached-at") ?? "") : null);
      const items = parsed.items ?? [];
      setData({ items, total: parsed.total ?? 0, searchTerms: parsed.searchTerms ?? [], issuers: parsed.issuers ?? [] });
      setFocusedIdx(-1);
    } catch (e) {
      if (ctrl.signal.aborted) return; // отменён более новым запросом или размонтированием
      setError(e instanceof Error ? e.message : t("Ошибка сети"));
    } finally {
      if (loadAbortRef.current === ctrl) setLoading(false);
    }
  }, [f, page, t]);

  useEffect(() => {
    if (!restored) return;
    // setTimeout(0) склеивает одновременные изменения (фильтры + страница) в один запрос.
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load, restored]);

  useEffect(() => () => loadAbortRef.current?.abort(), []);

  useEffect(() => {
    const h = () => {
      void load().then(() => {
        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
          fetch("/api/articles?level=1&minTrust=80&pageSize=3")
            .then((r) => (r.ok ? r.json() : {}))
            .then((d: { items?: Article[] }) => {
              const top = d.items?.find((a) => !a.isRead);
              if (top) {
                new Notification(t("ENT Evidence Radar: важное исследование"), {
                  body: `${top.title}\n${t("{journal} · Доверие {score}/100", { journal: top.journal || t("ЛОР"), score: top.trustScore })}`,
                });
              }
            })
            .catch(() => {});
        }
      });
    };
    window.addEventListener("ent-radar:refreshed", h);
    return () => window.removeEventListener("ent-radar:refreshed", h);
  }, [load, t]);

  // Синхронизируем фильтры/поиск/страницу в URL (replaceState — без захламления истории).
  useEffect(() => {
    // Не затираем глубокую ссылку, пока восстановление из URL ещё не выполнено.
    if (!restored) return;
    const url = `${window.location.pathname}?${toParams(f, page, PAGE_SIZE).toString()}`;
    window.history.replaceState(null, "", url);
  }, [f, page, restored]);

  // Pull-to-refresh обработчики
  const handlePtrTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (window.scrollY === 0 && touch) {
      ptrStartY.current = touch.clientY;
      ptrTriggered.current = false;
    } else {
      ptrStartY.current = -1;
    }
  }, []);

  const handlePtrTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (ptrStartY.current < 0 || !touch) return;
    const dy = touch.clientY - ptrStartY.current;
    if (dy > 60 && !ptrTriggered.current) {
      ptrTriggered.current = true;
      setPtrActive(true);
    }
  }, []);

  const handlePtrTouchEnd = useCallback(() => {
    if (ptrTriggered.current) {
      ptrTriggered.current = false;
      void load().finally(() => setPtrActive(false));
    }
  }, [load]);

  const set = (patch: Partial<Filters>) => {
    setF((s) => ({ ...s, ...patch }));
    setPage(1);
    setFocusedIdx(-1);
  };
  const reset = () => {
    setF(INITIAL_FILTERS);
    setQ("");
    setPage(1);
    setFocusedIdx(-1);
  };
  /** Пресет (встроенный или пользовательский): сброс, затем его условия; строка поиска — из пресета. */
  const applyPreset = (pf: Partial<Filters>) => {
    reset();
    set(pf);
    setQ(pf.q ?? "");
  };

  // ── Пользовательские пресеты фильтров (I-14), localStorage
  const [userPresets, setUserPresets] = useState<UserPreset[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => setUserPresets(loadUserPresets()), 0);
    return () => clearTimeout(timer);
  }, []);
  const saveUserPreset = () => {
    const name = window.prompt(t("Название пресета (например, «Ринология: СО/МА за год»)"))?.trim().slice(0, USER_PRESET_NAME_MAX);
    if (!name) return;
    const next = [...userPresets.filter((p) => p.name !== name), { name, f }].slice(-USER_PRESETS_MAX);
    setUserPresets(next);
    persistUserPresets(next);
  };
  const removeUserPreset = (name: string) => {
    const next = userPresets.filter((p) => p.name !== name);
    setUserPresets(next);
    persistUserPresets(next);
  };
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const exportParams = useMemo(() => toParams(f, 1, 2000), [f]);
  const feed = useMemo(() => feedLink(f, locale), [f, locale]);

  // Годы для селектов: из реальных дат публикаций в текущей выборке + текущий год
  // + выбранные значения (чтобы не «терялись» при смене страницы).
  const yearOptions = useMemo(() => {
    const years = new Set<number>([new Date().getFullYear()]);
    if (f.fromYear) years.add(Number(f.fromYear));
    if (f.toYear) years.add(Number(f.toYear));
    for (const a of data.items) {
      if (a.publishedAt) years.add(new Date(a.publishedAt).getUTCFullYear());
    }
    return [...years].sort((a, b) => b - a);
  }, [data.items, f.fromYear, f.toYear]);
  const activeCount = useMemo(() => countActiveFilters(f), [f]);

  const onUpdate = (a: Article) => {
    setSelected(a);
    setData((d) => ({ ...d, items: d.items.map((x) => (x.id === a.id ? a : x)) }));
  };

  // I-14: отметить всю текущую страницу прочитанной одним запросом.
  const markPageRead = async () => {
    const ids = data.items.filter((a) => !a.isRead).map((a) => a.id);
    if (!ids.length) return;
    const r = await fetch("/api/articles/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, isRead: true }) });
    if (r.ok) setData((d) => ({ ...d, items: d.items.map((x) => (ids.includes(x.id) ? { ...x, isRead: true } : x)) }));
  };

  // Список литературы по ГОСТ Р 7.0.5 для всех статей текущей страницы — в буфер обмена
  // (для доклада, диссертации или истории болезни; формат цитирования — A-13).
  const [gostCopied, setGostCopied] = useState(false);
  const copyGostCitations = async () => {
    if (!data.items.length) return;
    await navigator.clipboard.writeText(data.items.map((a) => citeGost({ ...a, authors: a.authors ?? [] })).join("\n"));
    setGostCopied(true);
    setTimeout(() => setGostCopied(false), 2500);
  };

  const quickToggle = async (a: Article, patch: Partial<Article>) => {
    const r = await fetch(`/api/articles/${a.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    if (r.ok) {
      const upd = (await r.json()) as Article;
      setData((d) => ({ ...d, items: d.items.map((x) => (x.id === upd.id ? upd : x)) }));
    }
  };

  // Горячие клавиши для навигации по ленте
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const tag = activeEl?.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || (activeEl as HTMLElement)?.isContentEditable) {
        return;
      }

      if (e.key === "?") {
        e.preventDefault();
        setShowShortcutsModal((s) => !s);
        return;
      }

      if (e.key === "Escape") {
        if (showShortcutsModal) {
          setShowShortcutsModal(false);
          return;
        }
        if (selected) {
          setSelected(null);
          return;
        }
        if (focusedIdx !== -1) {
          setFocusedIdx(-1);
          return;
        }
      }

      if (selected) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIdx((prev) => (prev + 1 < data.items.length ? prev + 1 : prev));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIdx((prev) => (prev > 0 ? prev - 1 : 0));
      } else if (e.key === "Enter") {
        const item = data.items[focusedIdx];
        if (item) {
          e.preventDefault();
          setSelected(item);
        }
      } else if (e.key === "b") {
        const item = data.items[focusedIdx];
        if (item) {
          e.preventDefault();
          void quickToggle(item, { isBookmarked: !item.isBookmarked });
        }
      } else if (e.key === "r") {
        const item = data.items[focusedIdx];
        if (item) {
          e.preventDefault();
          void quickToggle(item, { isRead: !item.isRead });
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [data.items, focusedIdx, selected, showShortcutsModal]);

  // Скролл сфокусированной статьи в видимую зону
  useEffect(() => {
    if (focusedIdx >= 0 && listRef.current) {
      const el = listRef.current.children[focusedIdx] as HTMLElement;
      if (el) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [focusedIdx]);

  const sidebar = (
    <FilterSidebar
      f={f}
      topics={topics}
      issuers={data.issuers}
      yearOptions={yearOptions}
      activeCount={activeCount}
      userPresets={userPresets}
      exportParams={exportParams}
      feedHref={feed.href}
      feedHasFilters={feed.hasFilters}
      onChange={set}
      onApplyPreset={applyPreset}
      onReset={reset}
      onSavePreset={saveUserPreset}
      onRemovePreset={removeUserPreset}
    />
  );

  return (
    <div
      className="grid gap-5 lg:grid-cols-[288px_1fr]"
      onTouchStart={handlePtrTouchStart}
      onTouchMove={handlePtrTouchMove}
      onTouchEnd={handlePtrTouchEnd}
    >
      {/* Desktop sidebar */}
      <aside className="hidden lg:block">
        <div className="card sticky top-[76px] rounded-2xl p-4">{sidebar}</div>
      </aside>

      {/* Mobile filter bottom sheet */}
      {showFilters && (
        <div className="fixed inset-0 z-40 flex items-end lg:hidden" onClick={() => setShowFilters(false)}>
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" />
          <div
            ref={filtersRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("Фильтры ленты")}
            tabIndex={-1}
            className="sheet-enter relative w-full overflow-y-auto overscroll-contain rounded-t-3xl bg-[color:var(--surface-1)] px-4 pb-4 pt-3 shadow-[var(--shadow-modal)] outline-none"
            style={{ maxHeight: "85dvh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-handle mb-3 text-slate-400" />
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-[color:var(--ink)]">{t("Фильтры")}</h2>
              <button
                onClick={() => setShowFilters(false)}
                className="rounded-xl p-2 text-[color:var(--ink-muted)] hover:bg-[color:var(--surface-3)]"
                aria-label={t("Закрыть фильтры")}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            {sidebar}
            <button
              onClick={() => setShowFilters(false)}
              className="btn-brand mt-5 w-full rounded-xl py-3 text-sm font-semibold text-white"
            >
              {t("Применить")}
            </button>
            <div className="pb-safe" />
          </div>
        </div>
      )}

      <section className="min-w-0">
        {/* Pull-to-refresh indicator */}
        {ptrActive && (
          <div className="mb-2 flex items-center justify-center gap-2 text-xs text-[color:var(--brand-ink)]">
            <svg viewBox="0 0 24 24" className="h-4 w-4 ptr-spinning" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
            {t("Обновляем…")}
          </div>
        )}

        {/* ── Панель инструментов ── */}
        <div className="card mb-3 flex flex-wrap items-center gap-2 rounded-2xl p-2">
          <div className="relative min-w-0 flex-1">
            <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--ink-subtle)]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("Поиск по названию, авторам, журналу…")}
              aria-label={t("Поиск публикаций")}
              type="search"
              className="field w-full rounded-xl py-2.5 pl-9 pr-8 text-sm text-[color:var(--ink)]"
            />
            {q && (
              <button
                onClick={() => setQ("")}
                aria-label={t("Очистить поиск")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-[color:var(--ink-subtle)] hover:bg-[color:var(--surface-3)] hover:text-[color:var(--ink)]"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            )}
          </div>
          {/* Фильтры: кнопка на мобиле */}
          <button
            onClick={() => setShowFilters((s) => !s)}
            className={`flex items-center gap-1.5 rounded-xl border py-2.5 px-3 text-sm font-medium transition lg:hidden ${
              activeCount
                ? "border-[color:var(--brand-ring)] bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]"
                : "btn-ghost"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="12" y1="18" x2="12" y2="18" /></svg>
            {activeCount ? `${t("Фильтры")} (${activeCount})` : t("Фильтры")}
          </button>
          <select
            value={f.q && f.sort === "date" ? "relevance" : f.sort}
            onChange={(e) => set({ sort: e.target.value as Filters["sort"] })}
            className="field rounded-xl px-3 py-2.5 text-sm text-[color:var(--ink-soft)]"
            aria-label={t("Сортировка")}
          >
            {f.q && <option value="relevance">{t("По релевантности")}</option>}
            <option value="date">{t("Новые")}</option>
            <option value="fetched">{t("Недавние")}</option>
            <option value="trust">{t("По доверию")}</option>
          </select>
          <button
            onClick={() => setShowShortcutsModal(true)}
            title={t("Горячие клавиши (?)")}
            className={`${GHOST_BTN} hidden items-center gap-1.5 md:inline-flex`}
          >
            <kbd className="rounded bg-[color:var(--surface-3)] px-1 py-0.5 font-mono text-[11px]">?</kbd>
            <span>{t("Клавиши")}</span>
          </button>
          <button
            onClick={requestNotification}
            title={
              notifyPerm === "granted"
                ? t("Уведомления о важных статьях включены")
                : t("Включить браузерные уведомления о статьях 1-го уровня")
            }
            className={`hidden items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-medium transition md:inline-flex ${
              notifyPerm === "granted"
                ? "border-[color:var(--brand-ring)] bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]"
                : "btn-ghost"
            }`}
          >
            <IconBell off={notifyPerm !== "granted"} className="h-4 w-4 shrink-0" />
            <span>{notifyPerm === "granted" ? t("Уведомления") : t("Оповещения")}</span>
          </button>
          {data.items.length > 0 && (
            <button
              type="button"
              onClick={() => void copyGostCitations()}
              className="btn-ghost hidden items-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-medium md:inline-flex"
              title={t("Список литературы по ГОСТ Р 7.0.5 для всех статей этой страницы — в буфер обмена (для доклада, статьи или диссертации)")}
            >
              {gostCopied ? <IconCheck className="h-4 w-4 shrink-0" /> : <IconCopy className="h-4 w-4 shrink-0" />}
              <span>{gostCopied ? t("Скопировано") : t("Цитаты (ГОСТ)")}</span>
            </button>
          )}
          {data.items.some((a) => !a.isRead) && (
            <button
              type="button"
              onClick={() => void markPageRead()}
              className="btn-ghost hidden items-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-medium md:inline-flex"
              title={t("Отметить все статьи на этой странице прочитанными")}
            >
              <IconCheckDouble className="h-4 w-4 shrink-0" />
              <span>{t("Страницу прочитано")}</span>
            </button>
          )}
          <span className="ml-auto shrink-0 pl-1 text-xs font-medium tabular-nums text-[color:var(--ink-muted)]">
            {loading ? "…" : t("{n} ст.", { n: number(data.total) })}
          </span>
        </div>

        {f.q && (
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 text-xs text-[color:var(--ink-muted)]">
            <div className="flex items-center gap-0.5" role="group" aria-label={t("Область поиска")}>
              {SCOPES.map((sc) => (
                <button
                  key={sc}
                  type="button"
                  aria-pressed={f.scope === sc}
                  onClick={() => set({ scope: sc })}
                  title={sc === "notes" ? t("Подстрока в ваших заметках, без синонимов и стемминга") : undefined}
                  className={`rounded-md px-2 py-0.5 transition ${f.scope === sc ? "bg-[color:var(--brand-soft)] font-semibold text-[color:var(--brand-a)]" : "hover:bg-[color:var(--surface-2)]"}`}
                >
                  {t(SCOPE_LABEL[sc] ?? sc)}
                </button>
              ))}
            </div>
            {data.searchTerms.length > 0 && (
              <span className="min-w-0 truncate" title={data.searchTerms.join(", ")}>
                {t("Искали по термам:")} <span className="text-[color:var(--ink-soft)]">{data.searchTerms.slice(0, 8).join(", ")}{data.searchTerms.length > 8 ? ` +${data.searchTerms.length - 8}` : ""}</span>
              </span>
            )}
          </div>
        )}

        {loading && data.items.length === 0 && (
          <div className="stagger space-y-2.5" aria-hidden>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ "--stagger-i": Math.min(i, 8) } as CSSProperties} className="card rounded-2xl p-4">
                <div className="flex gap-3.5">
                  <div className="skeleton h-12 w-12 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-2 py-0.5">
                    <div className="flex gap-1.5">
                      <div className="skeleton h-5 w-14" />
                      <div className="skeleton h-5 w-10" />
                      <div className="skeleton h-5 w-16" />
                    </div>
                    <div className="skeleton h-4 w-3/4" />
                    <div className="skeleton h-3 w-full" />
                    <div className="skeleton h-3 w-5/6" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {(!online || cachedAt !== null) && !loading && !error && (
          <div role="status" className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200">
            <span className="font-semibold">{online ? t("Данные из офлайн-кэша") : t("Нет соединения")}</span>
            <span>
              {cachedAt
                ? t("показана лента, сохранённая {when}; обновится при появлении сети.", { when: formatCachedAt(cachedAt) })
                : t("показаны последние загруженные данные; действия с записями пока недоступны.")}
            </span>
          </div>
        )}
        {error && !loading && (
          <div className="card fade-in rounded-2xl border-rose-200/70 p-8 text-center dark:border-rose-900/50">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-rose-50 dark:bg-rose-950/40">
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-rose-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 9v4M12 17h.01" /><circle cx="12" cy="12" r="9" /></svg>
            </div>
            <p className="text-base font-semibold text-[color:var(--ink)]">{t("Не удалось загрузить ленту")}</p>
            <p className="mt-1 text-sm text-[color:var(--ink-muted)]">{error}. {t("Проверьте соединение и попробуйте ещё раз.")}</p>
            <button
              onClick={() => void load()}
              className="btn-brand mt-4 rounded-xl px-4 py-2 text-sm font-semibold text-white"
            >
              {t("Повторить")}
            </button>
          </div>
        )}

        {!loading && !error && data.items.length === 0 && (
          <div className="card fade-in rounded-2xl border-dashed p-10 text-center">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl" style={{ background: "var(--brand-soft)" }}>
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: "var(--brand-a)" }}>
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </div>
            <p className="text-base font-semibold text-[color:var(--ink)]">{t("Пока ничего не найдено")}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-[color:var(--ink-muted)]">
              {data.total === 0 && activeCount === 0 && !f.q
                ? t("База пуста. Запустите обновление — приложение опросит PubMed, Europe PMC, ClinicalTrials.gov и medRxiv (обычно 1–3 минуты).")
                : t("Попробуйте ослабить фильтры или изменить запрос.")}
            </p>
            {data.total === 0 && activeCount === 0 && !f.q && (
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("ent-radar:refresh-request"))}
                className="btn-brand mt-4 rounded-xl px-4 py-2 text-sm font-semibold text-white"
              >
                {t("Обновить данные")}
              </button>
            )}
          </div>
        )}

        <ul
          ref={listRef}
          className={animateIn ? "stagger space-y-2.5" : "space-y-2.5"}
          // Каскад нужен только на первой отрисовке: когда анимация закончилась, класс снимается,
          // и смена фильтра больше не «прыгает» (V-08). При reduced-motion события нет — и не надо.
          onAnimationEnd={animateIn ? () => setAnimateIn(false) : undefined}
        >
          {data.items.map((a, idx) => (
            <ArticleCard
              key={a.id}
              article={a}
              focused={idx === focusedIdx}
              searchTerms={data.searchTerms}
              topicNames={topicNames(a)}
              onOpen={() => {
                setFocusedIdx(idx);
                setSelected(a);
              }}
              onToggle={(patch) => void quickToggle(a, patch)}
            />
          ))}
        </ul>

        {totalPages > 1 && (
          <div className="mt-5 flex items-center justify-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="btn-ghost flex h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-medium disabled:opacity-40"
            >
              {t("← Назад")}
            </button>
            <span className="min-w-[80px] text-center text-sm font-medium tabular-nums text-[color:var(--ink-muted)]">{page} / {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="btn-ghost flex h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-medium disabled:opacity-40"
            >
              {t("Вперёд →")}
            </button>
          </div>
        )}
      </section>

      <ShortcutsModal open={showShortcutsModal} onClose={() => setShowShortcutsModal(false)} />

      <ArticleDrawer
        article={selected}
        onClose={() => setSelected(null)}
        onUpdate={onUpdate}
        onSelectArticle={(a) => setSelected(a)}
      />
    </div>
  );
}
