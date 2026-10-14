import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import type { AppSettings } from "@/lib/defaults";
import { buildDigestData, renderDigest } from "@/lib/digest";
import { getRecipients, isMailerConfigured, sendMail } from "@/lib/mailer";
import { log } from "@/lib/log";

/**
 * Дайджест по расписанию из настроек (аудит A-09). Состояние последней отправки хранится
 * в `settings` под ключом `digest_state`, поэтому несколько инстансов/рестартов не шлют
 * письмо дважды, а в UI видно «когда и кому ушло в последний раз».
 */
export interface DigestState {
  lastSentAt?: string;
  lastRecipients?: string[];
  lastTotal?: number;
  lastDryRun?: boolean;
  lastError?: string;
  lastErrorAt?: string;
}

const STATE_KEY = "digest_state";

export async function getDigestState(): Promise<DigestState> {
  const rows = await db.select().from(settings).where(eq(settings.key, STATE_KEY));
  return (rows[0]?.value as DigestState | undefined) ?? {};
}

async function saveDigestState(patch: DigestState) {
  const next = { ...(await getDigestState()), ...patch };
  await db
    .insert(settings)
    .values({ key: STATE_KEY, value: next, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: new Date() } });
  return next;
}

/**
 * Чистая проверка «пора ли слать»: нужный день недели (или ежедневно при -1) и час наступили,
 * а с прошлой отправки прошло больше 20 часов (чтобы один и тот же слот не сработал дважды).
 */
export function isDigestDue(cfg: Pick<AppSettings, "digestEnabled" | "digestWeekday" | "digestHour">, state: DigestState, now = new Date()): boolean {
  if (!cfg.digestEnabled) return false;
  if (cfg.digestWeekday >= 0 && now.getDay() !== cfg.digestWeekday) return false;
  if (now.getHours() < cfg.digestHour) return false;
  const last = state.lastSentAt ? Date.parse(state.lastSentAt) : 0;
  if (last && now.getTime() - last < 20 * 3_600_000) return false;
  // Не досылать «пропущенный» дайджест глубокой ночью следующего дня: слот действует 6 часов.
  if (now.getHours() - cfg.digestHour > 6) return false;
  return true;
}

export interface DigestSendResult {
  sent: boolean;
  dryRun: boolean;
  to: string[];
  total: number;
  days: number;
}

/** Собирает и отправляет дайджест текущим получателям; фиксирует состояние. */
export async function sendDigestNow(cfg: Pick<AppSettings, "digestRecipients" | "digestDays">, trigger: "scheduled" | "manual"): Promise<DigestSendResult> {
  const to = getRecipients(cfg.digestRecipients);
  if (!to.length) throw new Error("Не заданы получатели дайджеста (настройки или DIGEST_RECIPIENTS)");
  const days = Math.max(1, Math.min(60, cfg.digestDays || 7));
  try {
    const data = await buildDigestData(days);
    const { html, text } = renderDigest(data);
    const res = await sendMail(to, `Дайджест ENT Evidence Radar за ${days} дн.`, html, text);
    await saveDigestState({ lastSentAt: new Date().toISOString(), lastRecipients: to, lastTotal: data.total, lastDryRun: res.dryRun, lastError: undefined, lastErrorAt: undefined });
    log.info("digest.sent", { trigger, to: to.length, total: data.total, dryRun: res.dryRun, days });
    return { sent: true, dryRun: res.dryRun, to, total: data.total, days };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await saveDigestState({ lastError: msg, lastErrorAt: new Date().toISOString() }).catch(() => {});
    log.error("digest.failed", { trigger, error: msg });
    throw e;
  }
}

/** Тик планировщика: отправить дайджест, если по настройкам пора. Ошибки не роняют планировщик. */
export async function maybeSendScheduledDigest(cfg: AppSettings, now = new Date()): Promise<boolean> {
  if (!cfg.digestEnabled) return false;
  const state = await getDigestState();
  if (!isDigestDue(cfg, state, now)) return false;
  if (!getRecipients(cfg.digestRecipients).length) {
    log.warn("digest.skipped_no_recipients");
    return false;
  }
  if (!isMailerConfigured()) log.warn("digest.smtp_not_configured_dry_run");
  await sendDigestNow(cfg, "scheduled").catch(() => undefined);
  return true;
}
