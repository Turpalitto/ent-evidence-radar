"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

function subscribeNotification(callback: () => void) {
  if (typeof window === "undefined" || !("navigator" in window) || !("permissions" in navigator)) return () => {};
  let cleanup = () => {};
  navigator.permissions.query({ name: "notifications" as PermissionName }).then((status) => {
    status.addEventListener("change", callback);
    cleanup = () => status.removeEventListener("change", callback);
  }).catch(() => {});
  return () => cleanup();
}

function getNotificationSnapshot(): string {
  if (typeof window !== "undefined" && "Notification" in window) {
    return Notification.permission;
  }
  return "default";
}

function getServerNotificationSnapshot(): string {
  return "default";
}
import type { Article, Topic } from "@/db/schema";
import { DESIGN_LABELS, DESIGN_SHORT, SOURCE_LABELS, SUBSPECIALTIES, EVIDENCE_LEVEL_LABELS } from "@/lib/evidence/taxonomy";
import { extractConclusion } from "@/lib/evidence/abstract";
import { DesignBadge, LevelBadge, SourceBadge, SubBadge, TierBadge, TrustScore, formatDate } from "./Badges";
import { ArticleDrawer } from "./ArticleDrawer";
import { useFocusTrap } from "./useFocusTrap";

interface Filters {
  q: string;
  subspecialty: string;
  design: string;
  level: string;
  minTrust: number;
  source: string;
  days: string;
  fromYear: string;
  toYear: string;
  bookmarked: boolean;
  unread: boolean;
  topicId: string;
  excludePreprints: boolean;
  sort: "date" | "trust" | "fetched";
}

const initial: Filters = {
  q: "",
  subspecialty: "",
  design: "",
  level: "",
  minTrust: 0,
  source: "",
  days: "",
  fromYear: "",
  toYear: "",
  bookmarked: false,
  unread: false,
  topicId: "",
  excludePreprints: false,
  sort: "date",
};

const THIS_YEAR = new Date().getFullYear();

const PRESETS: { label: string; f: Partial<Filters>; hint: string }[] = [
  { label: "⚡ Изменит практику", f: { level: "2", minTrust: 70, sort: "trust" }, hint: "СО/МА, руководства и РКИ с высоким доверием (≥70)" },
  { label: "Только высший уровень", f: { level: "1", minTrust: 60 }, hint: "СО/МА и руководства, доверие ≥60" },
  { label: "Свежие РКИ", f: { design: "rct", days: "30" }, hint: "РКИ за 30 дней" },
  { label: "Руководства", f: { design: "guideline" }, hint: "Клинические руководства и консенсусы" },
  { label: "Cochrane", f: { q: "Cochrane" }, hint: "Cochrane Database of Systematic Reviews" },
  { label: "Непрочитанное ≥70", f: { unread: true, minTrust: 70, sort: "trust" }, hint: "Что стоит прочитать в первую очередь" },
  { label: "Этот год", f: { fromYear: String(THIS_YEAR) }, hint: `Исследования, опубликованные с 1 января ${THIS_YEAR} года` },
  { label: "Прошлый год", f: { fromYear: String(THIS_YEAR - 1), toYear: String(THIS_YEAR - 1) }, hint: `Только публикации ${THIS_YEAR - 1} года` },
];

function toParams(f: Filters, page: number, pageSize: number) {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.subspecialty) p.set("subspecialty", f.subspecialty);
  if (f.design) p.set("design", f.design);
  if (f.level) p.set("level", f.level);
  if (f.minTrust) p.set("minTrust", String(f.minTrust));
  if (f.source) p.set("source", f.source);
  if (f.days) p.set("days", f.days);
  if (f.fromYear) p.set("fromYear", f.fromYear);
  if (f.toYear) p.set("toYear", f.toYear);
  if (f.bookmarked) p.set("bookmarked", "1");
  if (f.unread) p.set("unread", "1");
  if (f.topicId) p.set("topicId", f.topicId);
  if (f.excludePreprints) p.set("excludePreprints", "1");
  p.set("sort", f.sort);
  p.set("page", String(page));
  p.set("pageSize", String(pageSize));
  return p;
}

/** Поверхностное сравнение фильтров: все поля — примитивы. Нужно, чтобы не создавать
 *  новый объект (и не перезапрашивать ленту), когда значения фактически не изменились. */
function sameFilters(a: Filters, b: Filters): boolean {
  for (const k of Object.keys(initial) as (keyof Filters)[]) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/** Восстанавливает фильтры, поиск и страницу из query-строки (для shareable-ссылок). */
function parseUrlSearch(): { f: Filters; page: number; q: string } {
  if (typeof window === "undefined") return { f: initial, page: 1, q: "" };
  const p = new URLSearchParams(window.location.search);
  const num = (k: string) => {
    const v = p.get(k);
    return v ? Number(v) : 0;
  };
  const sort = p.get("sort");
  const f: Filters = {
    q: p.get("q") ?? "",
    subspecialty: p.get("subspecialty") ?? "",
    design: p.get("design") ?? "",
    level: p.get("level") ?? "",
    minTrust: num("minTrust") || 0,
    source: p.get("source") ?? "",
    days: p.get("days") ?? "",
    fromYear: p.get("fromYear") ?? "",
    toYear: p.get("toYear") ?? "",
    bookmarked: p.get("bookmarked") === "1",
    unread: p.get("unread") === "1",
    topicId: p.get("topicId") ?? "",
    excludePreprints: p.get("excludePreprints") === "1",
    sort: sort === "trust" || sort === "date" || sort === "fetched" ? sort : initial.sort,
  };
  const page = Math.max(1, Math.round(num("page")) || 1);
  return { f, page, q: f.q };
}

/* ── Общие классы полей и кнопок (единый премиальный язык) ── */
const SELECT_CLS = "field w-full rounded-xl px-2.5 py-1.5 text-sm text-[color:var(--ink-soft)]";
const GHOST_BTN = "btn-ghost rounded-xl px-3 py-2.5 text-sm font-medium";

export function Feed({ topics }: { topics: Topic[] }) {
  const [f, setF] = useState<Filters>(initial);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 30;
  const [data, setData] = useState<{ items: Article[]; total: number }>({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Article | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  // Pull-to-refresh
  const [ptrActive, setPtrActive] = useState(false);
  const ptrStartY = useRef(0);
  const ptrTriggered = useRef(false);

  const listRef = useRef<HTMLUListElement>(null);
  const shortcutsRef = useRef<HTMLDivElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  const aiConfiguredRef = useRef<boolean | null>(null);
  const notifyPerm = useSyncExternalStore(subscribeNotification, getNotificationSnapshot, getServerNotificationSnapshot);

  // Удержание фокуса в открытых модалках/листах + возврат фокуса при закрытии.
  useFocusTrap(shortcutsRef, showShortcutsModal);
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
        body: "Уведомления включены: вы получите оповещение при появлении публикаций 1-го уровня доказательности с доверием ≥80.",
      });
    }
  };

  // Восстанавливаем фильтры/поиск/страницу из URL после монтирования (детерминированный первый рендер).
  // Первый запрос ленты откладываем до восстановления, иначе на маунте уходило 2–3 запроса
  // (initial → восстановленные из URL → debounce поиска) и столько же warm-вызовов AI.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      const parsed = parseUrlSearch();
      setF((prev) => (sameFilters(prev, parsed.f) ? prev : parsed.f));
      setQ(parsed.q);
      setPage(parsed.page);
      setRestored(true);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    // Не создаём новый объект фильтров, если строка поиска фактически не изменилась.
    const t = setTimeout(() => setF((s) => (s.q === q ? s : { ...s, q })), 200);
    return () => clearTimeout(t);
  }, [q]);

  // Защита от гонки: при смене фильтров предыдущий запрос отменяется, а его поздний
  // ответ не может перетереть актуальные данные.
  const loadAbortRef = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    loadAbortRef.current?.abort();
    const ctrl = new AbortController();
    loadAbortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/articles?${toParams(f, page, pageSize)}`, { cache: "no-store", signal: ctrl.signal });
      if (!r.ok) throw new Error(`Ошибка сервера ${r.status}`);
      const parsed = (await r.json()) as { items?: Article[]; total?: number };
      if (ctrl.signal.aborted) return;
      const items = parsed.items ?? [];
      setData({ items, total: parsed.total ?? 0 });
      setFocusedIdx(-1);
    } catch (e) {
      if (ctrl.signal.aborted) return; // отменён более новым запросом или размонтированием
      setError(e instanceof Error ? e.message : "Ошибка сети");
    } finally {
      if (loadAbortRef.current === ctrl) setLoading(false);
    }
  }, [f, page]);

  useEffect(() => {
    if (!restored) return;
    // setTimeout(0) склеивает одновременные изменения (фильтры + страница) в один запрос.
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
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
                new Notification("⚡ ENT Evidence Radar: важное исследование", {
                  body: `${top.title}\n${top.journal || "ЛОР"} · Доверие ${top.trustScore}/100`,
                });
              }
            })
            .catch(() => {});
        }
      });
    };
    window.addEventListener("ent-radar:refreshed", h);
    return () => window.removeEventListener("ent-radar:refreshed", h);
  }, [load]);

  // Синхронизируем фильтры/поиск/страницу в URL (replaceState — без захламления истории).
  useEffect(() => {
    // Не затираем глубокую ссылку, пока восстановление из URL ещё не выполнено.
    if (!restored) return;
    const url = `${window.location.pathname}?${toParams(f, page, pageSize).toString()}`;
    window.history.replaceState(null, "", url);
  }, [f, page, restored]);

  // Pull-to-refresh обработчики
  const handlePtrTouchStart = useCallback((e: React.TouchEvent) => {
    if (window.scrollY === 0) {
      ptrStartY.current = e.touches[0].clientY;
      ptrTriggered.current = false;
    } else {
      ptrStartY.current = -1;
    }
  }, []);

  const handlePtrTouchMove = useCallback((e: React.TouchEvent) => {
    if (ptrStartY.current < 0) return;
    const dy = e.touches[0].clientY - ptrStartY.current;
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
    setF(initial);
    setQ("");
    setPage(1);
    setFocusedIdx(-1);
  };
  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const exportParams = useMemo(() => toParams(f, 1, 2000), [f]);

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
  const activeCount = useMemo(
    () => Object.entries(f).filter(([k, v]) => {
      if (k === "sort") return false;
      return v !== initial[k as keyof Filters];
    }).length,
    [f],
  );

  // Пресет считается активным, когда все его условия включены в текущие фильтры.
  const presetActive = (pf: Partial<Filters>) => Object.entries(pf).every(([k, v]) => f[k as keyof Filters] === v);

  const onUpdate = (a: Article) => {
    setSelected(a);
    setData((d) => ({ ...d, items: d.items.map((x) => (x.id === a.id ? a : x)) }));
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
        if (focusedIdx >= 0 && focusedIdx < data.items.length) {
          e.preventDefault();
          setSelected(data.items[focusedIdx]);
        }
      } else if (e.key === "b") {
        if (focusedIdx >= 0 && focusedIdx < data.items.length) {
          e.preventDefault();
          const item = data.items[focusedIdx];
          void quickToggle(item, { isBookmarked: !item.isBookmarked });
        }
      } else if (e.key === "r") {
        if (focusedIdx >= 0 && focusedIdx < data.items.length) {
          e.preventDefault();
          const item = data.items[focusedIdx];
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

  const Sidebar = (
    <div className="space-y-5 text-sm">
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="eyebrow">Быстрые фильтры</h3>
          <button
            onClick={reset}
            className={`link-brand text-xs font-semibold hover:underline ${activeCount > 0 ? "" : "invisible"}`}
          >
            Сбросить{activeCount > 0 ? ` (${activeCount})` : ""}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              title={p.hint}
              onClick={() => { reset(); set(p.f); if (p.f.q) setQ(p.f.q); }}
              className={`chip transition ${
                presetActive(p.f)
                  ? "chip-brand font-semibold shadow-[var(--shadow-glow)]"
                  : "hover:border-[color:var(--brand-ring)] hover:text-[color:var(--brand-ink)]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="eyebrow mb-1.5 block">Субспециальность</span>
        <select value={f.subspecialty} onChange={(e) => set({ subspecialty: e.target.value })} className={SELECT_CLS}>
          <option value="">Все</option>
          {SUBSPECIALTIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </label>

      <label className="block">
        <span className="eyebrow mb-1.5 block">Дизайн исследования</span>
        <select value={f.design} onChange={(e) => set({ design: e.target.value })} className={SELECT_CLS}>
          <option value="">Все</option>
          {Object.entries(DESIGN_SHORT).map(([k, v]) => <option key={k} value={k} title={DESIGN_LABELS[k as keyof typeof DESIGN_LABELS]}>{v}</option>)}
        </select>
      </label>

      <label className="block">
        <span className="eyebrow mb-1.5 block">Уровень доказательности (не ниже)</span>
        <select value={f.level} onChange={(e) => set({ level: e.target.value })} className={SELECT_CLS}>
          <option value="">Любой</option>
          {[1, 2, 3, 4].map((l) => <option key={l} value={l} title={EVIDENCE_LEVEL_LABELS[l]}>Уровень {l}</option>)}
        </select>
      </label>

      <label className="block">
        <span className="eyebrow mb-1.5 flex justify-between">
          <span>Мин. индекс доверия</span>
          <span className="tabular-nums text-[color:var(--brand-ink)]">{f.minTrust}</span>
        </span>
        <input type="range" min={0} max={100} step={5} value={f.minTrust} onChange={(e) => set({ minTrust: Number(e.target.value) })} className="w-full accent-teal-600" />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="eyebrow mb-1.5 block">Источник</span>
          <select value={f.source} onChange={(e) => set({ source: e.target.value })} className={SELECT_CLS}>
            <option value="">Все</option>
            {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="eyebrow mb-1.5 block">Период</span>
          <select value={f.days} onChange={(e) => set({ days: e.target.value })} className={SELECT_CLS}>
            <option value="">Всё</option>
            <option value="7">7 дней</option>
            <option value="14">14 дней</option>
            <option value="30">30 дней</option>
            <option value="90">90 дней</option>
            <option value="365">Год</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className="eyebrow mb-1.5 block">Тема (поисковый запрос)</span>
        <select value={f.topicId} onChange={(e) => set({ topicId: e.target.value })} className={SELECT_CLS}>
          <option value="">Все темы</option>
          {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="eyebrow mb-1.5 block">Год от</span>
          <select value={f.fromYear} onChange={(e) => set({ fromYear: e.target.value, toYear: f.toYear && e.target.value && Number(e.target.value) > Number(f.toYear) ? e.target.value : f.toYear })} className={SELECT_CLS}>
            <option value="">Все</option>
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="eyebrow mb-1.5 block">Год до</span>
          <select value={f.toYear} onChange={(e) => set({ toYear: e.target.value, fromYear: f.fromYear && e.target.value && Number(e.target.value) < Number(f.fromYear) ? e.target.value : f.fromYear })} className={SELECT_CLS}>
            <option value="">Все</option>
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>

      <div className="space-y-2 text-[color:var(--ink-soft)]">
        <label className="flex items-center gap-2.5"><input type="checkbox" checked={f.unread} onChange={(e) => set({ unread: e.target.checked })} className="h-4 w-4 accent-teal-600" /> Только непрочитанные</label>
        <label className="flex items-center gap-2.5"><input type="checkbox" checked={f.bookmarked} onChange={(e) => set({ bookmarked: e.target.checked })} className="h-4 w-4 accent-teal-600" /> Только избранное</label>
        <label className="flex items-center gap-2.5"><input type="checkbox" checked={f.excludePreprints} onChange={(e) => set({ excludePreprints: e.target.checked })} className="h-4 w-4 accent-teal-600" /> Скрыть препринты</label>
      </div>

      <div className="border-t border-[color:var(--hairline)] pt-4">
        <span className="eyebrow mb-2 block">Экспорт выборки</span>
        <div className="flex gap-1.5">
          {(["csv", "ris", "json"] as const).map((fmt) => (
            <a key={fmt} href={`/api/export?format=${fmt}&${exportParams}`} className="btn-ghost flex-1 rounded-xl py-1.5 text-center text-xs font-semibold uppercase">
              {fmt}
            </a>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-[color:var(--ink-subtle)]">RIS — для Zotero / EndNote / Mendeley</p>
      </div>
    </div>
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
        <div className="card sticky top-[76px] rounded-2xl p-4">{Sidebar}</div>
      </aside>

      {/* Mobile filter bottom sheet */}
      {showFilters && (
        <div className="fixed inset-0 z-40 flex items-end lg:hidden" onClick={() => setShowFilters(false)}>
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" />
          <div
            ref={filtersRef}
            role="dialog"
            aria-modal="true"
            aria-label="Фильтры ленты"
            tabIndex={-1}
            className="sheet-enter relative w-full overflow-y-auto overscroll-contain rounded-t-3xl bg-[color:var(--surface-1)] px-4 pb-4 pt-3 shadow-[var(--shadow-modal)] outline-none"
            style={{ maxHeight: "85dvh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-handle mb-3 text-slate-400" />
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-[color:var(--ink)]">Фильтры</h2>
              <button
                onClick={() => setShowFilters(false)}
                className="rounded-xl p-2 text-[color:var(--ink-muted)] hover:bg-[color:var(--surface-3)]"
                aria-label="Закрыть фильтры"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            {Sidebar}
            <button
              onClick={() => setShowFilters(false)}
              className="btn-brand mt-5 w-full rounded-xl py-3 text-sm font-semibold text-white"
            >
              Применить
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
            Обновляем…
          </div>
        )}

        {/* ── Панель инструментов ── */}
        <div className="card mb-3 flex flex-wrap items-center gap-2 rounded-2xl p-2">
          <div className="relative min-w-0 flex-1">
            <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--ink-subtle)]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск по названию, авторам, журналу…"
              className="field w-full rounded-xl py-2.5 pl-9 pr-8 text-sm text-[color:var(--ink)]"
            />
            {q && (
              <button
                onClick={() => setQ("")}
                aria-label="Очистить поиск"
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
            {activeCount ? `Фильтры (${activeCount})` : "Фильтры"}
          </button>
          <select value={f.sort} onChange={(e) => set({ sort: e.target.value as Filters["sort"] })} className="field rounded-xl px-3 py-2.5 text-sm text-[color:var(--ink-soft)]">
            <option value="date">Новые</option>
            <option value="fetched">Недавние</option>
            <option value="trust">По доверию</option>
          </select>
          <button
            onClick={() => setShowShortcutsModal(true)}
            title="Горячие клавиши (?)"
            className={`${GHOST_BTN} hidden items-center gap-1.5 md:inline-flex`}
          >
            <kbd className="rounded bg-[color:var(--surface-3)] px-1 py-0.5 font-mono text-[11px]">?</kbd>
            <span>Клавиши</span>
          </button>
          <button
            onClick={requestNotification}
            title={
              notifyPerm === "granted"
                ? "Уведомления о важных статьях включены"
                : "Включить браузерные уведомления о статьях 1-го уровня"
            }
            className={`hidden items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-medium transition md:inline-flex ${
              notifyPerm === "granted"
                ? "border-[color:var(--brand-ring)] bg-[color:var(--brand-soft)] text-[color:var(--brand-ink)]"
                : "btn-ghost"
            }`}
          >
            <span>{notifyPerm === "granted" ? "🔔" : "🔕"}</span>
            <span>{notifyPerm === "granted" ? "Уведомления" : "Оповещения"}</span>
          </button>
          <span className="ml-auto shrink-0 pl-1 text-xs font-medium tabular-nums text-[color:var(--ink-muted)]">
            {loading ? "…" : `${data.total.toLocaleString("ru-RU")} ст.`}
          </span>
        </div>

        {loading && data.items.length === 0 && (
          <div className="stagger space-y-2.5" aria-hidden>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ "--stagger-i": i } as CSSProperties} className="card rounded-2xl p-4">
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

        {error && !loading && (
          <div className="card fade-in rounded-2xl border-rose-200/70 p-8 text-center dark:border-rose-900/50">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-rose-50 dark:bg-rose-950/40">
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-rose-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 9v4M12 17h.01" /><circle cx="12" cy="12" r="9" /></svg>
            </div>
            <p className="text-base font-semibold text-[color:var(--ink)]">Не удалось загрузить ленту</p>
            <p className="mt-1 text-sm text-[color:var(--ink-muted)]">{error}. Проверьте соединение и попробуйте ещё раз.</p>
            <button
              onClick={() => void load()}
              className="btn-brand mt-4 rounded-xl px-4 py-2 text-sm font-semibold text-white"
            >
              Повторить
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
            <p className="text-base font-semibold text-[color:var(--ink)]">Пока ничего не найдено</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-[color:var(--ink-muted)]">
              {data.total === 0 && activeCount === 0 && !f.q
                ? "База пуста. Запустите обновление — приложение опросит PubMed, Europe PMC, ClinicalTrials.gov и medRxiv (обычно 1–3 минуты)."
                : "Попробуйте ослабить фильтры или изменить запрос."}
            </p>
            {data.total === 0 && activeCount === 0 && !f.q && (
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("ent-radar:refresh-request"))}
                className="btn-brand mt-4 rounded-xl px-4 py-2 text-sm font-semibold text-white"
              >
                Обновить данные
              </button>
            )}
          </div>
        )}

        <ul ref={listRef} className="stagger space-y-2.5">
          {data.items.map((a, idx) => {
            const isFocused = idx === focusedIdx;
            const conclusion = extractConclusion(a.abstract);
            return (
              <li
                key={a.id}
                tabIndex={0}
                aria-label={a.title}
                className={`card card-lift card-sheen group relative cursor-pointer overflow-hidden rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-ring)] ${
                  isFocused ? "ring-2 ring-[color:var(--brand-ring)]" : ""
                }`}
                onClick={() => {
                  setFocusedIdx(idx);
                  setSelected(a);
                }}
                onKeyDown={(e) => {
                  // Enter/Space открывают статью прямо из сфокусированного элемента списка.
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    setFocusedIdx(idx);
                    setSelected(a);
                  }
                }}
              >
                {/* Градиентный акцент для непрочитанных */}
                {!a.isRead && (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-1"
                    style={{ background: "linear-gradient(180deg, var(--brand-a), var(--brand-b))" }}
                  />
                )}

                {/* Desktop layout */}
                <div className="hidden gap-3.5 p-4 sm:flex">
                  <TrustScore score={a.trustScore} />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <DesignBadge design={a.studyDesign} />
                      <LevelBadge level={a.evidenceLevel} />
                      <TierBadge tier={a.journalTier} />
                      {a.subspecialties.map((s) => <SubBadge key={s} k={s} />)}
                      {a.isPreprint && <span title="Препринт" className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">ПРЕПРИНТ</span>}
                      {a.isRetracted && <span title="Статья отозвана" className="rounded bg-red-700 px-1.5 py-0.5 text-[10px] font-bold text-white">ОТОЗВАНА</span>}
                      <span className="ml-auto flex items-center gap-1">{a.sourceKeys.map((s) => <SourceBadge key={s} k={s} />)}</span>
                    </div>
                    <h3 className={`text-[15px] leading-snug transition-colors ${a.isRead ? "font-medium text-[color:var(--ink-soft)]" : "font-semibold text-[color:var(--ink)]"} group-hover:text-[color:var(--brand-ink)]`}>
                      {a.title}
                    </h3>
                    {conclusion ? (
                      <div className="mt-2 rounded-xl border border-teal-100 bg-teal-50/70 p-2.5 dark:border-teal-900/50 dark:bg-teal-950/30">
                        <p className="line-clamp-2 text-[12.5px] leading-relaxed text-teal-950 dark:text-teal-100">
                          <span className="font-semibold text-teal-700 dark:text-teal-400">💡 Вывод: </span>
                          {conclusion}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-[color:var(--ink-muted)]">{a.abstract || "Аннотация недоступна"}</p>
                    )}
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--ink-muted)]">
                      <span className="font-medium text-[color:var(--ink-soft)]">{a.journal || "—"}</span>
                      <span>{formatDate(a.publishedAt)}</span>
                      {a.authors.length > 0 && <span className="truncate">{a.authors.slice(0, 3).join(", ")}{a.authors.length > 3 ? " и др." : ""}</span>}
                      {a.sampleSize && <span>n≈{a.sampleSize}</span>}
                      <span className="ml-auto flex gap-1">
                        <button onClick={(e) => { e.stopPropagation(); void quickToggle(a, { isBookmarked: !a.isBookmarked }); }} className={`rounded-md px-1.5 py-0.5 transition ${a.isBookmarked ? "text-amber-600 dark:text-amber-400" : "text-[color:var(--ink-subtle)] hover:text-amber-600 dark:hover:text-amber-400"}`} title="Избранное (b)">{a.isBookmarked ? "★" : "☆"}</button>
                        <button onClick={(e) => { e.stopPropagation(); void quickToggle(a, { isRead: !a.isRead }); }} className="rounded-md px-1.5 py-0.5 text-[color:var(--ink-subtle)] transition hover:text-[color:var(--brand-ink)]" title={a.isRead ? "Непрочитанным (r)" : "Прочитано (r)"}>{a.isRead ? "↺" : "✓"}</button>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Mobile compact layout */}
                <div className="p-3 sm:hidden">
                  <div className="mb-2 flex items-center gap-2">
                    <TrustScore score={a.trustScore} size="sm" />
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                      <DesignBadge design={a.studyDesign} />
                      <LevelBadge level={a.evidenceLevel} />
                      {a.isPreprint && <span className="rounded bg-rose-600 px-1 py-0.5 text-[9px] font-bold text-white">ПРЕПРИНТ</span>}
                      {a.isRetracted && <span className="rounded bg-red-700 px-1 py-0.5 text-[9px] font-bold text-white">ОТОЗВАНА</span>}
                    </div>
                    {/* Large tap targets for mobile quick actions */}
                    <button
                      onClick={(e) => { e.stopPropagation(); void quickToggle(a, { isBookmarked: !a.isBookmarked }); }}
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg transition ${a.isBookmarked ? "text-amber-500" : "text-[color:var(--ink-subtle)]"}`}
                      aria-label="Избранное"
                    >
                      {a.isBookmarked ? "★" : "☆"}
                    </button>
                  </div>
                  <h3 className={`text-sm leading-snug ${a.isRead ? "font-medium text-[color:var(--ink-soft)]" : "font-semibold text-[color:var(--ink)]"}`}>
                    {a.title}
                  </h3>
                  {conclusion && (
                    <div className="mt-1.5 rounded-lg border border-teal-100 bg-teal-50/60 p-2 dark:border-teal-900/40 dark:bg-teal-950/20">
                      <p className="line-clamp-2 text-[11px] leading-relaxed text-teal-900 dark:text-teal-200">
                        <span className="font-semibold text-teal-700 dark:text-teal-400">💡 Вывод: </span>
                        {conclusion}
                      </p>
                    </div>
                  )}
                  <div className="mt-1.5 flex items-center gap-2 text-[12px] text-[color:var(--ink-muted)]">
                    <span className="min-w-0 truncate font-medium text-[color:var(--ink-soft)]">{a.journal || "—"}</span>
                    <span className="shrink-0">{formatDate(a.publishedAt)}</span>
                    {a.isRead && <span className="ml-auto shrink-0 text-[color:var(--brand-ink)]">✓</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {totalPages > 1 && (
          <div className="mt-5 flex items-center justify-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="btn-ghost flex h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-medium disabled:opacity-40"
            >
              ← Назад
            </button>
            <span className="min-w-[80px] text-center text-sm font-medium tabular-nums text-[color:var(--ink-muted)]">{page} / {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="btn-ghost flex h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-medium disabled:opacity-40"
            >
              Вперёд →
            </button>
          </div>
        )}
      </section>

      {/* Модальное окно горячих клавиш */}
      {showShortcutsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]" onClick={() => setShowShortcutsModal(false)}>
          <div ref={shortcutsRef} role="dialog" aria-modal="true" aria-label="Горячие клавиши" tabIndex={-1} className="card overlay-enter w-full max-w-sm rounded-2xl p-5 shadow-[var(--shadow-modal)] outline-none" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-[color:var(--ink)]">Горячие клавиши</h3>
              <button onClick={() => setShowShortcutsModal(false)} className="rounded-lg p-1.5 text-[color:var(--ink-subtle)] hover:bg-[color:var(--surface-3)] hover:text-[color:var(--ink)]">✕</button>
            </div>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between">
                <span className="text-[color:var(--ink-soft)]">Следующая статья</span>
                <kbd className="rounded bg-[color:var(--surface-3)] px-2 py-0.5 font-mono text-xs text-[color:var(--ink-soft)]">j / ↓</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-[color:var(--ink-soft)]">Предыдущая статья</span>
                <kbd className="rounded bg-[color:var(--surface-3)] px-2 py-0.5 font-mono text-xs text-[color:var(--ink-soft)]">k / ↑</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-[color:var(--ink-soft)]">Открыть подробности</span>
                <kbd className="rounded bg-[color:var(--surface-3)] px-2 py-0.5 font-mono text-xs text-[color:var(--ink-soft)]">Enter</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-[color:var(--ink-soft)]">В избранное / из избранного</span>
                <kbd className="rounded bg-[color:var(--surface-3)] px-2 py-0.5 font-mono text-xs text-[color:var(--ink-soft)]">b</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-[color:var(--ink-soft)]">Прочитано / непрочитано</span>
                <kbd className="rounded bg-[color:var(--surface-3)] px-2 py-0.5 font-mono text-xs text-[color:var(--ink-soft)]">r</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-[color:var(--ink-soft)]">Закрыть / сбросить фокус</span>
                <kbd className="rounded bg-[color:var(--surface-3)] px-2 py-0.5 font-mono text-xs text-[color:var(--ink-soft)]">Esc</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-[color:var(--ink-soft)]">Справка по клавишам</span>
                <kbd className="rounded bg-[color:var(--surface-3)] px-2 py-0.5 font-mono text-xs text-[color:var(--ink-soft)]">?</kbd>
              </li>
            </ul>
          </div>
        </div>
      )}

      <ArticleDrawer
        article={selected}
        onClose={() => setSelected(null)}
        onUpdate={onUpdate}
        onSelectArticle={(a) => setSelected(a)}
      />
    </div>
  );
}
