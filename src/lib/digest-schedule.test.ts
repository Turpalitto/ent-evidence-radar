import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/mailer", async (orig) => {
  const m = await orig<typeof import("@/lib/mailer")>();
  return { ...m, sendMail: vi.fn(async (to: string[]) => ({ sent: true, to, dryRun: true })), isMailerConfigured: () => false };
});

import { getDigestState, isDigestDue, maybeSendScheduledDigest, sendDigestNow } from "@/lib/digest-schedule";
import { DEFAULT_SETTINGS } from "@/lib/defaults";
import { sendMail } from "@/lib/mailer";

const monday9 = new Date(2026, 9, 12, 9, 5); // понедельник 12.10.2026, 09:05 локального времени

describe("дайджест по расписанию (A-09)", () => {
  it("isDigestDue: день недели, час, окно 6 ч и защита от повторной отправки", () => {
    const cfg = { digestEnabled: true, digestWeekday: 1, digestHour: 8 };
    expect(isDigestDue(cfg, {}, monday9)).toBe(true);
    expect(isDigestDue({ ...cfg, digestEnabled: false }, {}, monday9)).toBe(false);
    expect(isDigestDue({ ...cfg, digestWeekday: 2 }, {}, monday9)).toBe(false);
    expect(isDigestDue({ ...cfg, digestWeekday: -1 }, {}, monday9)).toBe(true); // ежедневно
    expect(isDigestDue({ ...cfg, digestHour: 10 }, {}, monday9)).toBe(false); // ещё рано
    expect(isDigestDue(cfg, {}, new Date(2026, 9, 12, 15, 1))).toBe(false); // слот 8–14 прошёл
    expect(isDigestDue(cfg, { lastSentAt: new Date(2026, 9, 12, 8, 1).toISOString() }, monday9)).toBe(false); // уже слали
    expect(isDigestDue(cfg, { lastSentAt: new Date(2026, 9, 5, 8, 1).toISOString() }, monday9)).toBe(true); // неделю назад
  });

  it("sendDigestNow: получатели из настроек, состояние фиксируется; без получателей — ошибка", async () => {
    await expect(sendDigestNow({ digestRecipients: "", digestDays: 7 }, "manual")).rejects.toThrow(/получатели/i);
    const r = await sendDigestNow({ digestRecipients: "Doc@Example.org, doc@example.org; second@example.org", digestDays: 14 }, "manual");
    expect(r.to).toEqual(["doc@example.org", "second@example.org"]);
    expect(r.dryRun).toBe(true);
    expect(r.days).toBe(14);
    const state = await getDigestState();
    expect(state.lastRecipients).toEqual(["doc@example.org", "second@example.org"]);
    expect(state.lastDryRun).toBe(true);
    expect(state.lastError).toBeUndefined();
  });

  it("maybeSendScheduledDigest: шлёт только когда пора и не дублирует в тот же слот", async () => {
    const cfg = { ...DEFAULT_SETTINGS, digestEnabled: true, digestRecipients: "doc@example.org", digestWeekday: -1, digestHour: 8 };
    const calls = (sendMail as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    const later = new Date(Date.now() + 8 * 24 * 3_600_000);
    later.setHours(9, 0, 0, 0);
    expect(await maybeSendScheduledDigest(cfg, later)).toBe(true);
    expect((sendMail as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(calls + 1);
    // Состояние lastSentAt = сейчас (реальное время) — повтор в «later» заблокирован? later − now = 8 дней → не заблокирован,
    // поэтому проверяем защиту по близкому времени: через час после реальной отправки.
    const soon = new Date(Date.now() + 3_600_000);
    soon.setHours(9, 0, 0, 0);
    expect(await maybeSendScheduledDigest(cfg, soon)).toBe(false);
    expect(await maybeSendScheduledDigest({ ...cfg, digestEnabled: false }, later)).toBe(false);
  });
});
