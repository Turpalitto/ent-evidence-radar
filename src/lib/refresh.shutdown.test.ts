import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";

// Источники «висят», имитируя долгий сбор, пока процесс получает SIGTERM.
let release: () => void = () => {};
const hang = new Promise<never>((_, rej) => {
  release = () => rej(new Error("процесс завершён (тест)"));
});
vi.mock("@/lib/sources/pubmed", () => ({
  fetchPubmed: vi.fn(() => hang),
  pubmedRetractedSet: vi.fn(async () => new Set<string>()),
  pubmedRetractionMap: vi.fn(async () => new Map<string, boolean>()),
}));
vi.mock("@/lib/sources/europepmc", () => ({ fetchEuropePmc: vi.fn(() => hang), fetchEuropePmcQuery: vi.fn(() => hang) }));
vi.mock("@/lib/sources/clinicaltrials", () => ({ fetchClinicalTrials: vi.fn(() => hang) }));
vi.mock("@/lib/sources/medrxiv", () => ({ fetchMedrxiv: vi.fn(() => hang) }));

import { db } from "@/db";
import { fetchRuns } from "@/db/schema";
import { abortCurrentRefresh, ensureSeeded, isRefreshRunning, lockStatus, startRefresh } from "@/lib/refresh";

describe("abortCurrentRefresh — штатная остановка во время запуска", () => {
  it("помечает запуск failed, снимает блокировку и освобождает процесс без ожидания аренды", async () => {
    await ensureSeeded();
    const s = await startRefresh("manual");
    expect(s.skipped).toBeFalsy();
    expect(isRefreshRunning()).toBe(true);
    expect(await lockStatus()).not.toBeNull();

    expect(await abortCurrentRefresh()).toBe(true);

    expect(isRefreshRunning()).toBe(false);
    expect(await lockStatus()).toBeNull();
    const [run] = await db.select().from(fetchRuns).where(eq(fetchRuns.id, s.runId));
    expect(run.status).toBe("failed");
    expect(run.errorMessage).toMatch(/SIGTERM/);
    expect(run.finishedAt).not.toBeNull();

    // Новый запуск возможен сразу — блокировка не висит 6 минут.
    expect(await abortCurrentRefresh()).toBe(false); // нечего прерывать
    release();
    await s.done.catch(() => {});
  });
});
