import { describe, it, expect, vi } from "vitest";
import { decodeEntities, fetchWithRetry, retryAfterMs, stripTags } from "@/lib/sources/http";

describe("decodeEntities", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;")).toBe("a & b < c > d \"e\" 'f'");
    expect(decodeEntities("I&#xB2; = 45%; CI 1.4&#8211;3.2; &#x2264; &#8805;")).toBe("I² = 45%; CI 1.4–3.2; ≤ ≥");
  });

  it("leaves unknown or invalid entities untouched and decodes only one level", () => {
    expect(decodeEntities("&unknown; &#0; &#xD800; &#1114112;")).toBe("&unknown; &#0; &#xD800; &#1114112;");
    expect(decodeEntities("&amp;lt;img&amp;gt;")).toBe("&lt;img&gt;");
  });
});

describe("stripTags", () => {
  it("removes inline markup but keeps text order and spacing", () => {
    expect(stripTags("Role of <i>Staphylococcus aureus</i> biofilm: a <b>systematic</b> review")).toBe(
      "Role of Staphylococcus aureus biofilm: a systematic review",
    );
    expect(stripTags("10<sup>6</sup> cells, IL-1<sub>β</sub>, <mml:math><mml:mi>p</mml:mi></mml:math>")).toBe("106 cells, IL-1β, p");
  });

  it("strips tags BEFORE decoding entities, so encoded tags stay inert text", () => {
    expect(stripTags("safe &lt;script&gt;alert(1)&lt;/script&gt;")).toBe("safe <script>alert(1)</script>");
    expect(stripTags("<b>bold</b> &amp; p &lt; 0.05")).toBe("bold & p < 0.05");
  });

  it("collapses whitespace and handles empty input", () => {
    expect(stripTags("  a \n\t b  ")).toBe("a b");
    expect(stripTags(null)).toBe("");
    expect(stripTags(undefined)).toBe("");
  });
});

describe("retryAfterMs (F-32)", () => {
  const mk = (v: string | null) => ({ headers: { get: () => v } });
  it("секунды, HTTP-дата, отсутствие и потолок", () => {
    expect(retryAfterMs(mk("2"))).toBe(2000);
    expect(retryAfterMs(mk(null))).toBeNull();
    expect(retryAfterMs(mk("garbage"))).toBeNull();
    expect(retryAfterMs(mk("600"))).toBe(60_000);
    const future = new Date(Date.now() + 5000).toUTCString();
    const ms = retryAfterMs(mk(future));
    expect(ms).toBeGreaterThan(3000);
    expect(ms).toBeLessThanOrEqual(5000);
  });
});

describe("fetchWithRetry уважает Retry-After и выстраивает конкурентные вызовы в очередь", () => {
  it("после 429 с Retry-After ждёт указанное время и повторяет", async () => {
    const calls: number[] = [];
    const fetchMock = vi.fn(async () => {
      calls.push(Date.now());
      return calls.length === 1 ? new Response("slow down", { status: 429, headers: { "retry-after": "0.3" } }) : new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const res = await fetchWithRetry("https://eutils.ncbi.nlm.nih.gov/x", { retries: 1 });
      expect(res.status).toBe(200);
      expect(calls).toHaveLength(2);
      expect(calls[1] - calls[0]).toBeGreaterThanOrEqual(280);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("параллельные вызовы с одним throttleKey уходят с шагом throttleMs, а не пачкой", async () => {
    const stamps: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        stamps.push(Date.now());
        return new Response("ok", { status: 200 });
      }),
    );
    try {
      await Promise.all([1, 2, 3].map(() => fetchWithRetry("https://example.org/", { throttleKey: "t-test", throttleMs: 120, retries: 0 })));
      stamps.sort((a, b) => a - b);
      expect(stamps[1] - stamps[0]).toBeGreaterThanOrEqual(100);
      expect(stamps[2] - stamps[1]).toBeGreaterThanOrEqual(100);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
