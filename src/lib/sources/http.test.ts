import { describe, it, expect, vi } from "vitest";
import { decodeEntities, fetchJson, fetchText, fetchWithRetry, htmlAbstractToText, retryAfterMs, stripTags } from "@/lib/sources/http";

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

  it("htmlAbstractToText: заголовки <h4> Europe PMC → «Label: » на отдельной строке, абзацы → строки, инлайн-теги — как stripTags", () => {
    expect(
      htmlAbstractToText("<h4>Objective</h4>To compare routes. <h4>Methods</h4>PROSPERO-registered review.<h4>Conclusions:</h4>No difference (OR 1.2, 95% CI 0.9&#x2013;1.5)."),
    ).toBe("Objective: To compare routes.\nMethods: PROSPERO-registered review.\nConclusions: No difference (OR 1.2, 95% CI 0.9–1.5).");
    expect(htmlAbstractToText("<p>Background: Sudden hearing loss.</p><p>Methods: We did a trial.</p>")).toBe("Background: Sudden hearing loss.\nMethods: We did a trial.");
    expect(htmlAbstractToText("Plain abstract with <i>italic</i>, 10<sup>6</sup> cells and 5 &lt; 6.")).toBe("Plain abstract with italic, 106 cells and 5 < 6.");
    expect(htmlAbstractToText("line one<br/>line two<br>  \n ")).toBe("line one\nline two");
    // Закодированные теги остаются текстом (как у stripTags)
    expect(htmlAbstractToText("&lt;h4&gt;Not a heading&lt;/h4&gt; text")).toBe("<h4>Not a heading</h4> text");
    expect(htmlAbstractToText("")).toBe("");
    expect(htmlAbstractToText(null)).toBe("");
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

  it("5xx: повтор с backoff, после последней попытки — ошибка без лишнего ожидания; 4xx не повторяется", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => { n++; return new Response("down", { status: 503, headers: { "retry-after": n === 1 ? "0.2" : "20" } }); }));
    try {
      const t0 = Date.now();
      await expect(fetchJson("https://api.example.org/x", { retries: 1 })).rejects.toThrow(/HTTP 503 from api.example.org/);
      expect(n).toBe(2);
      const spent = Date.now() - t0;
      expect(spent).toBeGreaterThanOrEqual(180); // Retry-After между попытками учтён…
      // …но Retry-After: 20 с последнего ответа не ждём — иначе каждый сбой источника держал бы refresh лишние десятки секунд.
      expect(spent).toBeLessThan(3_000);
    } finally {
      vi.unstubAllGlobals();
    }
    n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => { n++; return new Response("nope", { status: 404, statusText: "Not Found" }); }));
    try {
      await expect(fetchText("https://api.example.org/missing", { retries: 2 })).rejects.toThrow(/HTTP 404 Not Found \(api.example.org\)/);
      expect(n).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("таймаут прерывает запрос через AbortController и считается как timeout; сетевая ошибка повторяется", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      })),
    );
    try {
      await expect(fetchWithRetry("https://slow.example.org/", { timeoutMs: 30, retries: 0 })).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      vi.unstubAllGlobals();
    }
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => { n++; if (n === 1) throw new TypeError("fetch failed"); return new Response("ok", { status: 200 }); }));
    try {
      const res = await fetchWithRetry("https://flaky.example.org/", { retries: 1 });
      expect(res.status).toBe(200);
      expect(n).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("429 с throttleKey штрафует очередь: следующий вызов с тем же ключом ждёт Retry-After", async () => {
    const stamps: number[] = [];
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => { n++; stamps.push(Date.now()); return n === 1 ? new Response("slow", { status: 429, headers: { "retry-after": "0.25" } }) : new Response("ok", { status: 200 }); }));
    try {
      await expect(fetchWithRetry("https://eutils.ncbi.nlm.nih.gov/a", { throttleKey: "penalty-test", retries: 0 })).rejects.toThrow(/HTTP 429/);
      const t0 = Date.now();
      await fetchWithRetry("https://eutils.ncbi.nlm.nih.gov/b", { throttleKey: "penalty-test", retries: 0 });
      expect(Date.now() - t0).toBeGreaterThanOrEqual(200);
      expect(stamps[1] - stamps[0]).toBeGreaterThanOrEqual(200);
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
