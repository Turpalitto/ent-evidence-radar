import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { deploymentDefaultLocale, i18nOf, localeOf } from "./request";
import { LOCALE_COOKIE, msg } from "./index";
import { parseBody } from "@/lib/api";
import { checkApiAuth } from "@/lib/security";
import { publicRateLimit } from "@/lib/public-api";

/**
 * Язык API-ответов (A-16, продолжение): ошибки маршрутов, авторизации и rate-limit приходят
 * на языке запроса — cookie переключателя, `?lang=` для ссылок без cookie, иначе язык развёртывания.
 */

function req(headers: Record<string, string> = {}, url = "http://localhost/api/x", method = "POST") {
  return new Request(url, { method, headers });
}

describe("localeOf / i18nOf", () => {
  const prevDefault = process.env.DEFAULT_LOCALE;
  afterEach(() => {
    if (prevDefault === undefined) delete process.env.DEFAULT_LOCALE;
    else process.env.DEFAULT_LOCALE = prevDefault;
  });

  it("без cookie и параметра — язык развёртывания (по умолчанию ru)", () => {
    delete process.env.DEFAULT_LOCALE;
    expect(deploymentDefaultLocale()).toBe("ru");
    expect(localeOf(req())).toBe("ru");
    process.env.DEFAULT_LOCALE = "en";
    expect(localeOf(req())).toBe("en");
    process.env.DEFAULT_LOCALE = "de"; // неизвестный → встроенный ru
    expect(localeOf(req())).toBe("ru");
  });

  it("cookie переключателя задаёт язык; мусор в cookie игнорируется", () => {
    expect(localeOf(req({ cookie: `a=1; ${LOCALE_COOKIE}=en; b=2` }))).toBe("en");
    expect(localeOf(req({ cookie: `${LOCALE_COOKIE}=EN-US` }))).toBe("en");
    expect(localeOf(req({ cookie: `${LOCALE_COOKIE}=%E2%82` }))).toBe("ru"); // битый percent-encoding
    expect(localeOf(req({ cookie: `${LOCALE_COOKIE}=xx` }))).toBe("ru");
    expect(localeOf(req({ cookie: `other_${LOCALE_COOKIE}=en` }))).toBe("ru"); // похожее имя — не наша cookie
  });

  it("?lang= имеет приоритет над cookie (ленты и экспорт без cookie)", () => {
    expect(localeOf(req({ cookie: `${LOCALE_COOKIE}=ru` }, "http://localhost/feed.xml?lang=en"))).toBe("en");
    expect(localeOf(req({ cookie: `${LOCALE_COOKIE}=en` }, "http://localhost/feed.xml?lang=ru"))).toBe("ru");
    expect(localeOf(req({ cookie: `${LOCALE_COOKIE}=en` }, "http://localhost/feed.xml?lang=zz"))).toBe("en");
    // Объект без url (минимальный HeadersLike) — только cookie
    expect(localeOf({ headers: { get: (n: string) => (n === "cookie" ? `${LOCALE_COOKIE}=en` : null) } })).toBe("en");
  });

  it("i18nOf переводит по словарю на языке запроса", () => {
    expect(i18nOf(req({ cookie: `${LOCALE_COOKIE}=en` })).t("Внутренняя ошибка сервера")).toBe("Internal server error");
    expect(i18nOf(req()).t("Внутренняя ошибка сервера")).toBe("Внутренняя ошибка сервера");
  });
});

describe("API-ошибки на языке запроса", () => {
  const schema = z.object({ n: z.number().int() }).refine((b) => b.n > 0, { message: msg("Нет допустимых полей для изменения") });

  it("parseBody: битый JSON и ошибки схемы — RU по умолчанию, EN по cookie; сообщения refine переводятся", async () => {
    const bad = (cookie?: string, body = "{") =>
      parseBody(new Request("http://localhost/api/x", { method: "POST", body, headers: cookie ? { cookie } : {} }), schema);

    const ru = await bad();
    expect(ru.ok).toBe(false);
    if (!ru.ok) expect((await ru.response.json()).error).toBe("Некорректный JSON");

    const en = await bad(`${LOCALE_COOKIE}=en`);
    if (!en.ok) expect((await en.response.json()).error).toBe("Malformed JSON");

    const refineEn = await bad(`${LOCALE_COOKIE}=en`, JSON.stringify({ n: 0 }));
    expect(refineEn.ok).toBe(false);
    if (!refineEn.ok) {
      const j = await refineEn.response.json();
      expect(j.error).toBe("Invalid request: body: No valid fields to update");
      expect(j.issues).toEqual(["body: No valid fields to update"]);
    }
    const refineRu = await bad(undefined, JSON.stringify({ n: 0 }));
    if (!refineRu.ok) expect((await refineRu.response.json()).error).toBe("Некорректный запрос: body: Нет допустимых полей для изменения");
  });

  describe("checkApiAuth", () => {
    const prev = process.env.API_SECRET;
    beforeEach(() => {
      process.env.API_SECRET = "s3cret";
    });
    afterEach(() => {
      if (prev === undefined) delete process.env.API_SECRET;
      else process.env.API_SECRET = prev;
    });

    it("401 без токена и сессии — текст на языке запроса", () => {
      const ru = checkApiAuth(req());
      expect(ru.ok).toBe(false);
      expect(ru.error).toMatch(/^Требуется авторизация/);
      const en = checkApiAuth(req({ cookie: `${LOCALE_COOKIE}=en` }));
      expect(en.status).toBe(401);
      expect(en.error).toBe("Authentication required: sign in at /login or pass API_SECRET (Bearer / X-API-Key)");
      // Токен работает независимо от языка
      expect(checkApiAuth(req({ authorization: "Bearer s3cret", cookie: `${LOCALE_COOKIE}=en` })).ok).toBe(true);
    });
  });

  it("publicRateLimit: 429 на языке запроса", () => {
    const cfg = { limit: 1, windowMs: 60_000 };
    const bucket = `i18n-test-${Date.now()}`;
    const headers = { "x-forwarded-for": "203.0.113.7", cookie: `${LOCALE_COOKIE}=en` };
    const prevTrust = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = "1";
    try {
      expect(publicRateLimit(req(headers, "http://localhost/api/articles", "GET"), bucket, cfg)).toBeNull();
      const limited = publicRateLimit(req(headers, "http://localhost/api/articles", "GET"), bucket, cfg);
      expect(limited?.status).toBe(429);
      return limited!.json().then((j: { error: string }) => expect(j.error).toBe("Too many requests, please try again later"));
    } finally {
      if (prevTrust === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = prevTrust;
    }
  });
});
