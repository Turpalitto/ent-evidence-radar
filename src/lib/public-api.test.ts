import { beforeEach, describe, expect, it } from "vitest";
import {
  ARTICLES_LIMIT,
  SHARED_BUCKET_FACTOR,
  conditionalJson,
  conditionalResponse,
  etagOf,
  ifModifiedSinceSatisfied,
  ifNoneMatchSatisfied,
  publicRateLimit,
} from "./public-api";

const req = (headers: Record<string, string> = {}) => new Request("http://radar.test/api/articles", { headers });

describe("ETag / условные ответы", () => {
  it("etagOf детерминирован, слабый и зависит от содержимого", () => {
    expect(etagOf("a")).toBe(etagOf("a"));
    expect(etagOf("a")).not.toBe(etagOf("b"));
    expect(etagOf("a")).toMatch(/^W\/"[0-9a-f]{32}"$/);
  });

  it("ifNoneMatchSatisfied: «*», список тегов, слабое сравнение", () => {
    const tag = etagOf("x");
    expect(ifNoneMatchSatisfied(null, tag)).toBe(false);
    expect(ifNoneMatchSatisfied("*", tag)).toBe(true);
    expect(ifNoneMatchSatisfied(tag, tag)).toBe(true);
    expect(ifNoneMatchSatisfied(`"other", ${tag}`, tag)).toBe(true);
    expect(ifNoneMatchSatisfied(tag.replace(/^W\//, ""), tag)).toBe(true); // сильный тег против слабого
    expect(ifNoneMatchSatisfied('"nope"', tag)).toBe(false);
  });

  it("ifModifiedSinceSatisfied сравнивает с секундной точностью и игнорирует мусор", () => {
    const lm = new Date("2026-10-14T10:00:00.750Z");
    expect(ifModifiedSinceSatisfied("Wed, 14 Oct 2026 10:00:00 GMT", lm)).toBe(true); // миллисекунды отброшены
    expect(ifModifiedSinceSatisfied("Wed, 14 Oct 2026 09:59:59 GMT", lm)).toBe(false);
    expect(ifModifiedSinceSatisfied("garbage", lm)).toBe(false);
    expect(ifModifiedSinceSatisfied("Wed, 14 Oct 2026 10:00:00 GMT", null)).toBe(false);
  });

  it("conditionalResponse: 200 с ETag/Last-Modified, затем 304 по If-None-Match без тела", async () => {
    const lm = new Date("2026-10-14T10:00:00Z");
    const first = conditionalResponse(req(), "<feed/>", { headers: { "Content-Type": "application/atom+xml", "Cache-Control": "public, max-age=600" }, lastModified: lm });
    expect(first.status).toBe(200);
    expect(await first.text()).toBe("<feed/>");
    const etag = first.headers.get("etag")!;
    expect(etag).toBe(etagOf("<feed/>"));
    expect(first.headers.get("last-modified")).toBe("Wed, 14 Oct 2026 10:00:00 GMT");

    const second = conditionalResponse(req({ "if-none-match": etag }), "<feed/>", { headers: { "Content-Type": "application/atom+xml", "Cache-Control": "public, max-age=600" }, lastModified: lm });
    expect(second.status).toBe(304);
    expect(second.body).toBeNull();
    expect(second.headers.get("etag")).toBe(etag);
    expect(second.headers.get("cache-control")).toBe("public, max-age=600");
    expect(second.headers.get("content-type")).toBeNull();

    // Содержимое изменилось — снова 200 с новым тегом
    const third = conditionalResponse(req({ "if-none-match": etag }), "<feed>new</feed>", { lastModified: lm });
    expect(third.status).toBe(200);
    expect(third.headers.get("etag")).not.toBe(etag);
  });

  it("If-None-Match приоритетнее If-Modified-Since; без ETag работает дата", () => {
    const lm = new Date("2026-10-14T10:00:00Z");
    const byDate = conditionalResponse(req({ "if-modified-since": "Wed, 14 Oct 2026 10:00:00 GMT" }), "body", { lastModified: lm });
    expect(byDate.status).toBe(304);
    // ETag не совпал → 200, хотя дата говорит «не менялось»
    const mismatch = conditionalResponse(req({ "if-none-match": '"stale"', "if-modified-since": "Wed, 14 Oct 2026 10:00:00 GMT" }), "body", { lastModified: lm });
    expect(mismatch.status).toBe(200);
  });

  it("conditionalJson сериализует данные, ставит JSON и private no-cache", async () => {
    const res = conditionalJson(req(), { items: [1, 2] });
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(await res.json()).toEqual({ items: [1, 2] });
    const again = conditionalJson(req({ "if-none-match": res.headers.get("etag")! }), { items: [1, 2] });
    expect(again.status).toBe(304);
  });
});

describe("publicRateLimit", () => {
  beforeEach(() => {
    delete process.env.TRUST_PROXY;
  });

  it("анонимные клиенты без TRUST_PROXY делят общий бакет с множителем", () => {
    const bucket = `t-${Math.random()}`;
    const cfg = { limit: 2, windowMs: 60_000 };
    const allowed = cfg.limit * SHARED_BUCKET_FACTOR;
    for (let i = 0; i < allowed; i++) expect(publicRateLimit(req(), bucket, cfg)).toBeNull();
    const blocked = publicRateLimit(req(), bucket, cfg);
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(blocked?.headers.get("cache-control")).toBe("no-store");
  });

  it("с TRUST_PROXY лимит считается на IP, разные IP независимы", () => {
    process.env.TRUST_PROXY = "1";
    const bucket = `t-${Math.random()}`;
    const cfg = { limit: 2, windowMs: 60_000 };
    const a = () => req({ "x-forwarded-for": "203.0.113.5" });
    const b = () => req({ "x-forwarded-for": "203.0.113.6" });
    expect(publicRateLimit(a(), bucket, cfg)).toBeNull();
    expect(publicRateLimit(a(), bucket, cfg)).toBeNull();
    expect(publicRateLimit(a(), bucket, cfg)?.status).toBe(429);
    expect(publicRateLimit(b(), bucket, cfg)).toBeNull();
  });

  it("Bearer-токен образует собственный бакет и не зависит от IP", () => {
    const bucket = `t-${Math.random()}`;
    const cfg = { limit: 1, windowMs: 60_000 };
    expect(publicRateLimit(req({ authorization: "Bearer abc" }), bucket, cfg)).toBeNull();
    expect(publicRateLimit(req({ authorization: "Bearer abc" }), bucket, cfg)?.status).toBe(429);
    expect(publicRateLimit(req({ authorization: "Bearer other" }), bucket, cfg)).toBeNull();
  });

  it("лимит ленты оставляет запас над дебаунсом поиска (5 запросов/с)", () => {
    expect(ARTICLES_LIMIT.limit / (ARTICLES_LIMIT.windowMs / 1000)).toBeGreaterThanOrEqual(4);
  });
});
