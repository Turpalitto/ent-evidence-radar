import type { EditorialNotice, EditorialNoticeType } from "@/db/schema";
import { fetchJson } from "./http";
import { normalizeDoi } from "@/lib/evidence/classify";

/**
 * Crossref REST API — редакционные уведомления по DOI (аудит A-04).
 *
 * У отозванной статьи в Crossref появляется отдельная запись-уведомление (retraction notice,
 * expression of concern, correction/erratum), у которой поле `update-to` ссылается на DOI
 * исходной работы. Фильтр `updates:{doi}` возвращает все такие уведомления. Это закрывает
 * записи без PMID (препринты medRxiv, Europe PMC PPR), которые перепроверка через PubMed не видит,
 * и добавляет «expression of concern» — PubMed его типом публикации не помечает.
 *
 * Политика Crossref: указываем `mailto` (polite pool) и User-Agent; один запрос покрывает пачку DOI
 * (несколько значений одного фильтра объединяются через OR).
 */

export const CROSSREF_BATCH = 20;
const API = "https://api.crossref.org/works";

/** Как Crossref помечает тип обновления → наш тип уведомления. Неизвестные типы игнорируем. */
const UPDATE_TYPES: Record<string, EditorialNoticeType> = {
  retraction: "retraction",
  retracted: "retraction",
  withdrawal: "withdrawal",
  withdrawn: "withdrawal",
  removal: "retraction",
  expression_of_concern: "expression_of_concern",
  "expression-of-concern": "expression_of_concern",
  concern: "expression_of_concern",
  correction: "correction",
  corrigendum: "correction",
  erratum: "correction",
  partial_retraction: "retraction",
  "partial-retraction": "retraction",
};

/** Чем серьёзнее уведомление, тем выше ранг; при нескольких уведомлениях храним самое серьёзное. */
const SEVERITY: Record<EditorialNoticeType, number> = { retraction: 4, withdrawal: 3, expression_of_concern: 2, correction: 1 };

export interface CrossrefUpdateTo {
  DOI?: string;
  type?: string;
  label?: string;
  updated?: { "date-parts"?: number[][]; "date-time"?: string };
}
export interface CrossrefWork {
  DOI?: string;
  type?: string;
  "update-to"?: CrossrefUpdateTo[];
}
export interface CrossrefWorksResponse {
  status?: string;
  message?: { items?: CrossrefWork[]; "total-results"?: number };
}

/** Контактный e-mail для polite pool Crossref; переиспользуем NCBI_EMAIL, чтобы не плодить переменные. */
function mailto(): string {
  return process.env.CROSSREF_EMAIL?.trim() || process.env.NCBI_EMAIL?.trim() || "ent-evidence-radar@example.org";
}

function dateOf(u: CrossrefUpdateTo): string | undefined {
  const parts = u.updated?.["date-parts"]?.[0];
  if (parts && parts.length >= 1 && Number.isFinite(parts[0])) {
    const [y, m = 1, d = 1] = parts;
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const dt = u.updated?.["date-time"];
  return dt ? dt.slice(0, 10) : undefined;
}

/** Не считаем уведомлением саму статью: Crossref иногда ссылается с DOI на него же (self-update). */
function isSelf(noticeDoi: string | undefined, targetDoi: string): boolean {
  return !!noticeDoi && normalizeDoi(noticeDoi) === targetDoi;
}

/**
 * Чистый разбор ответа `works?filter=updates:…`: DOI исходной работы (нормализованный) →
 * самое серьёзное уведомление. Тестируется на фикстуре без сети.
 */
export function parseCrossrefUpdates(resp: CrossrefWorksResponse, checkedAt = new Date().toISOString()): Map<string, EditorialNotice> {
  const out = new Map<string, EditorialNotice>();
  for (const work of resp.message?.items ?? []) {
    const noticeDoi = work.DOI ? normalizeDoi(work.DOI) ?? undefined : undefined;
    for (const u of work["update-to"] ?? []) {
      const target = u.DOI ? normalizeDoi(u.DOI) : null;
      if (!target) continue;
      const kind = UPDATE_TYPES[(u.type ?? "").toLowerCase().trim()];
      if (!kind) continue;
      if (isSelf(noticeDoi, target) && kind === "correction") continue; // «updated version» самой статьи — не уведомление
      const notice: EditorialNotice = {
        type: kind,
        noticeDoi: noticeDoi && noticeDoi !== target ? noticeDoi : undefined,
        date: dateOf(u),
        label: u.label?.trim() || undefined,
        source: "crossref",
        checkedAt,
      };
      const prev = out.get(target);
      if (!prev || SEVERITY[notice.type] > SEVERITY[prev.type] || (SEVERITY[notice.type] === SEVERITY[prev.type] && (notice.date ?? "") > (prev.date ?? ""))) {
        out.set(target, notice);
      }
    }
  }
  return out;
}

/** Уведомления этого типа означают, что статья отозвана. */
export function noticeMeansRetracted(n: EditorialNotice | null | undefined): boolean {
  return !!n && (n.type === "retraction" || n.type === "withdrawal");
}

/**
 * Запрашивает уведомления для списка DOI. Возвращает карту только по тем DOI, у которых
 * уведомления есть. Пачки по CROSSREF_BATCH; при ошибке пачки — одиночные запросы, чтобы один
 * «плохой» DOI не ронял всю проверку.
 */
export async function crossrefNoticesFor(dois: string[], opts: { fetch?: typeof fetchJson } = {}): Promise<Map<string, EditorialNotice>> {
  const get = opts.fetch ?? fetchJson;
  const uniq = [...new Set(dois.map((d) => normalizeDoi(d)).filter((d): d is string => !!d))];
  const out = new Map<string, EditorialNotice>();
  const merge = (m: Map<string, EditorialNotice>) => { for (const [k, v] of m) out.set(k, v); };
  const query = async (batch: string[]) => {
    const p = new URLSearchParams({
      filter: batch.map((d) => `updates:${d}`).join(","),
      rows: String(Math.max(20, batch.length * 3)),
      select: "DOI,type,update-to",
      mailto: mailto(),
    });
    const resp = await get(`${API}?${p}`, { throttleKey: "crossref", throttleMs: 150, timeoutMs: 20_000, retries: 1 });
    return parseCrossrefUpdates(resp as CrossrefWorksResponse);
  };
  for (let i = 0; i < uniq.length; i += CROSSREF_BATCH) {
    const batch = uniq.slice(i, i + CROSSREF_BATCH);
    try {
      merge(await query(batch));
    } catch (e) {
      if (batch.length === 1) throw e;
      // Одиночные запросы: «плохой» DOI (Crossref отвечает 400 на некорректный фильтр) пропускаем,
      // но если не удался ни один — это сеть/сервис, и ошибку надо поднять, чтобы курсор не ушёл вперёд.
      let okCount = 0;
      let lastErr: unknown = e;
      for (const d of batch) {
        try {
          merge(await query([d]));
          okCount++;
        } catch (err) {
          lastErr = err;
        }
      }
      if (okCount === 0) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    }
  }
  return out;
}
