import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { fetchRuns, settings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { alertThreshold, currentFailureStreak, deliverAlert, evaluateRunAlerts, type AlertMessage } from "@/lib/alerts";

async function addRun(status: "success" | "failed" | "partial" | "running", err?: string) {
  await new Promise((r) => setTimeout(r, 2)); // разные startedAt
  await db.insert(fetchRuns).values({ trigger: "manual", status, errorMessage: err ?? null, finishedAt: status === "running" ? null : new Date() });
}

describe("alerts (I-08, PGlite)", () => {
  beforeEach(async () => {
    await db.delete(fetchRuns);
    await db.delete(settings).where(eq(settings.key, "alert_state"));
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example.test/x";
    delete process.env.ALERT_FAILURES_THRESHOLD;
  });

  it("порог по умолчанию 3, некорректное значение игнорируется", () => {
    expect(alertThreshold()).toBe(3);
    process.env.ALERT_FAILURES_THRESHOLD = "abc";
    expect(alertThreshold()).toBe(3);
    process.env.ALERT_FAILURES_THRESHOLD = "5";
    expect(alertThreshold()).toBe(5);
  });

  it("считает серию подряд идущих failed, игнорируя running", async () => {
    await addRun("success");
    await addRun("failed", "a");
    await addRun("failed", "b");
    await addRun("running");
    const s = await currentFailureStreak();
    expect(s.streak).toBe(2);
    expect(s.latestError).toBe("b");
  });

  it("алерт один раз на серию, затем сообщение о восстановлении", async () => {
    const deliver = vi.fn(async (_m: AlertMessage) => ({ webhook: true, email: false }));
    await addRun("failed", "e1");
    await addRun("failed", "e2");
    expect(await evaluateRunAlerts({ deliver })).toBe("none");
    await addRun("failed", "e3");
    expect(await evaluateRunAlerts({ deliver })).toBe("alerted");
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0][0].kind).toBe("refresh_failures");
    expect(deliver.mock.calls[0][0].text).toContain("e3");
    await addRun("failed", "e4");
    expect(await evaluateRunAlerts({ deliver })).toBe("none"); // не спамим
    expect(deliver).toHaveBeenCalledTimes(1);
    await addRun("success");
    expect(await evaluateRunAlerts({ deliver })).toBe("recovered");
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver.mock.calls[1][0].kind).toBe("refresh_recovered");
    await addRun("success");
    expect(await evaluateRunAlerts({ deliver })).toBe("none");
  });

  it("без каналов ничего не делает", async () => {
    delete process.env.ALERT_WEBHOOK_URL;
    const deliver = vi.fn(async () => ({ webhook: true, email: false }));
    await addRun("failed");
    await addRun("failed");
    await addRun("failed");
    expect(await evaluateRunAlerts({ deliver })).toBe("none");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("deliverAlert шлёт JSON в вебхук и не падает при ошибке сети", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.text).toContain("Заголовок");
      expect(body.kind).toBe("test");
      return new Response("ok", { status: 200 });
    });
    const r = await deliverAlert({ kind: "test", title: "Заголовок", text: "Текст" }, fetchMock as unknown as typeof fetch);
    expect(r.webhook).toBe(true);
    const failing = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const r2 = await deliverAlert({ kind: "test", title: "t", text: "x" }, failing as unknown as typeof fetch);
    expect(r2.webhook).toBe(false);
  });
});
