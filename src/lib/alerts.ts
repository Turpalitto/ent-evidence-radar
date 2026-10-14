import { desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { fetchRuns, settings } from "@/db/schema";
import { log } from "@/lib/log";
import { metrics } from "@/lib/metrics";
import { getMailerConfig, getRecipients, isMailerConfigured, sendMail } from "@/lib/mailer";

/**
 * Алерты (аудит I-08): уведомление при N подряд неуспешных запусков обновления
 * (`ALERT_FAILURES_THRESHOLD`, по умолчанию 3) и при восстановлении.
 * Каналы: `ALERT_WEBHOOK_URL` (POST JSON, подходит для Slack/Telegram-шлюза/любого вебхука)
 * и e-mail (`ALERT_RECIPIENTS`, иначе `DIGEST_RECIPIENTS`, если настроен SMTP).
 * Состояние (чтобы не слать одно и то же каждую минуту) хранится в settings.alert_state.
 */
const STATE_KEY = "alert_state";

export interface AlertState {
  /** id запуска, по которому уже отправлен алерт о серии сбоев. */
  failureAlertedRunId?: number;
  /** Длина серии на момент последнего алерта. */
  failureStreak?: number;
  lastSentAt?: string;
}

export function alertThreshold(): number {
  const n = Number(process.env.ALERT_FAILURES_THRESHOLD ?? 3);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 3;
}

export function alertsConfigured(): boolean {
  return Boolean(process.env.ALERT_WEBHOOK_URL) || (isMailerConfigured() && alertRecipients().length > 0);
}

export function alertRecipients(): string[] {
  const own = (process.env.ALERT_RECIPIENTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return own.length ? own : getRecipients();
}

export interface AlertMessage {
  kind: "refresh_failures" | "refresh_recovered" | "test";
  title: string;
  text: string;
  fields?: Record<string, unknown>;
}

/** Доставка во все настроенные каналы; ошибки канала логируются и не пробрасываются. */
export async function deliverAlert(msg: AlertMessage, fetchImpl: typeof fetch = fetch): Promise<{ webhook: boolean; email: boolean }> {
  const out = { webhook: false, email: false };
  const webhook = process.env.ALERT_WEBHOOK_URL;
  if (webhook) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      const res = await fetchImpl(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `text` — поле, которое понимают Slack/Mattermost/Rocket.Chat; остальное — для своих обработчиков.
        body: JSON.stringify({ text: `${msg.title}\n${msg.text}`, kind: msg.kind, title: msg.title, fields: msg.fields ?? {}, app: "ent-evidence-radar" }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      out.webhook = res.ok;
      if (!res.ok) log.warn("alert.webhook_failed", { status: res.status });
    } catch (e) {
      log.warn("alert.webhook_failed", { error: e instanceof Error ? e.message : String(e) });
    }
  }
  const to = alertRecipients();
  if (to.length && isMailerConfigured()) {
    try {
      const r = await sendMail(to, `[ENT Radar] ${msg.title}`, `<p>${escapeHtml(msg.title)}</p><pre>${escapeHtml(msg.text)}</pre>`, `${msg.title}\n\n${msg.text}`, getMailerConfig());
      out.email = r.sent && !r.dryRun;
    } catch (e) {
      log.warn("alert.email_failed", { error: e instanceof Error ? e.message : String(e) });
    }
  }
  metrics.inc("alerts.sent", { kind: msg.kind });
  log.warn("alert.sent", { kind: msg.kind, title: msg.title, ...out });
  return out;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

async function readState(): Promise<AlertState> {
  const rows = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, STATE_KEY));
  return (rows[0]?.value as AlertState | undefined) ?? {};
}

async function writeState(state: AlertState) {
  await db
    .insert(settings)
    .values({ key: STATE_KEY, value: state, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: state, updatedAt: new Date() } });
}

/** Длина текущей серии подряд идущих `failed` среди завершённых запусков (с самого свежего). */
export async function currentFailureStreak(limit = 20): Promise<{ streak: number; latestRunId: number | null; latestError: string | null }> {
  const rows = await db
    .select({ id: fetchRuns.id, status: fetchRuns.status, errorMessage: fetchRuns.errorMessage })
    .from(fetchRuns)
    .where(ne(fetchRuns.status, "running"))
    .orderBy(desc(fetchRuns.startedAt), desc(fetchRuns.id))
    .limit(limit);
  let streak = 0;
  for (const r of rows) {
    if (r.status !== "failed") break;
    streak++;
  }
  return { streak, latestRunId: rows[0]?.id ?? null, latestError: rows[0]?.errorMessage ?? null };
}

/**
 * Вызывается после каждого завершённого запуска. Шлёт алерт один раз на серию
 * (когда серия достигла порога) и сообщение о восстановлении после успешного запуска.
 */
export async function evaluateRunAlerts(deps: { deliver?: typeof deliverAlert } = {}): Promise<"none" | "alerted" | "recovered"> {
  const deliver = deps.deliver ?? deliverAlert;
  if (!alertsConfigured()) return "none";
  const threshold = alertThreshold();
  const { streak, latestRunId, latestError } = await currentFailureStreak(Math.max(threshold + 1, 5));
  const state = await readState();

  if (streak >= threshold) {
    if (state.failureAlertedRunId !== undefined && (state.failureStreak ?? 0) > 0) return "none"; // уже сообщали об этой серии
    await deliver({
      kind: "refresh_failures",
      title: `Обновление литературы падает ${streak} раз(а) подряд`,
      text: `Последняя ошибка (run #${latestRunId}): ${latestError ?? "неизвестно"}\nПроверьте /api/health и журнал запусков.`,
      fields: { streak, latestRunId },
    });
    await writeState({ failureAlertedRunId: latestRunId ?? undefined, failureStreak: streak, lastSentAt: new Date().toISOString() });
    return "alerted";
  }

  if (streak === 0 && (state.failureStreak ?? 0) > 0) {
    await deliver({
      kind: "refresh_recovered",
      title: "Обновление литературы восстановилось",
      text: `Запуск #${latestRunId} завершился успешно после серии из ${state.failureStreak} сбоев.`,
      fields: { latestRunId, previousStreak: state.failureStreak },
    });
    await writeState({ lastSentAt: new Date().toISOString() });
    return "recovered";
  }
  return "none";
}
