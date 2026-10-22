import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as authState } from "@/app/api/auth/route";
import { SESSION_COOKIE } from "@/lib/session";

/**
 * Контракт маршрутов авторизации (`/api/auth/*`): вход по API_SECRET → httpOnly-cookie сессии,
 * same-origin как барьер для формы, rate-limit попыток по IP, выход сбрасывает cookie.
 * Общий rate-limit живёт в таблице `rate_limits` (PGlite в тестах), IP берётся из
 * `x-forwarded-for` при TRUST_PROXY=1 — у каждого теста свой IP, чтобы бакеты не пересекались.
 */

const SECRET = "test-secret-login";
const ENV_KEYS = ["API_SECRET", "SESSION_SECRET", "TRUST_PROXY"] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeAll(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.TRUST_PROXY = "1";
  delete process.env.SESSION_SECRET;
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function post(path: string, body: unknown, headers: Record<string, string> = {}, ip = "198.51.100.1") {
  return new NextRequest(`http://app.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "app.example", "x-forwarded-for": ip, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const sameOrigin = { origin: "http://app.example" };
const setCookie = (res: Response) => res.headers.get("set-cookie") ?? "";

describe("POST /api/auth/login", () => {
  it("без API_SECRET авторизация не требуется — 200 required:false", async () => {
    delete process.env.API_SECRET;
    const res = await login(post("/api/auth/login", { secret: "whatever" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, required: false });
    expect(setCookie(res)).toBe("");
  });

  it("с API_SECRET: не same-origin → 403, битое тело → 400, неверный секрет → 401", async () => {
    process.env.API_SECRET = SECRET;
    const foreign = await login(post("/api/auth/login", { secret: SECRET }, { origin: "https://evil.example" }, "198.51.100.2"));
    expect(foreign.status).toBe(403);
    expect((await foreign.json()).error).toMatch(/источник запроса/);

    const noOrigin = await login(post("/api/auth/login", { secret: SECRET }, {}, "198.51.100.2"));
    expect(noOrigin.status).toBe(403);

    const bad = await login(post("/api/auth/login", "{not json", sameOrigin, "198.51.100.3"));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("Некорректное тело запроса");

    const wrong = await login(post("/api/auth/login", { secret: "nope" }, sameOrigin, "198.51.100.3"));
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error).toBe("Неверный секрет");
    expect(setCookie(wrong)).toBe("");

    const empty = await login(post("/api/auth/login", { secret: "" }, sameOrigin, "198.51.100.3"));
    expect(empty.status).toBe(401);
  });

  it("верный секрет → httpOnly-cookie сессии (Secure только за HTTPS); cookie проходит GET /api/auth", async () => {
    process.env.API_SECRET = SECRET;
    const res = await login(post("/api/auth/login", { secret: SECRET }, { "sec-fetch-site": "same-origin" }, "198.51.100.4"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, required: true });
    const cookie = setCookie(res);
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=v1\\.`));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Secure/i);

    const https = await login(post("/api/auth/login", { secret: SECRET }, { ...sameOrigin, "x-forwarded-proto": "https" }, "198.51.100.5"));
    expect(setCookie(https)).toMatch(/Secure/i);

    // Состояние для интерфейса: с cookie — authenticated + session, без — нет.
    const token = cookie.split(";")[0]!;
    const withCookie = await authState(new NextRequest("http://app.example/api/auth", { headers: { cookie: token } }));
    expect(await withCookie.json()).toEqual({ required: true, authenticated: true, session: true });
    expect(withCookie.headers.get("cache-control")).toBe("no-store");
    const anon = await authState(new NextRequest("http://app.example/api/auth"));
    expect(await anon.json()).toEqual({ required: true, authenticated: false, session: false });
    const bearer = await authState(new NextRequest("http://app.example/api/auth", { headers: { authorization: `Bearer ${SECRET}` } }));
    expect(await bearer.json()).toEqual({ required: true, authenticated: true, session: false });
  });

  it("rate-limit: 10 попыток за 10 минут с одного IP, затем 429 с Retry-After", async () => {
    process.env.API_SECRET = SECRET;
    const ip = "198.51.100.77";
    for (let i = 0; i < 10; i++) {
      const r = await login(post("/api/auth/login", { secret: "wrong" }, sameOrigin, ip));
      expect(r.status).toBe(401);
    }
    const limited = await login(post("/api/auth/login", { secret: SECRET }, sameOrigin, ip));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await limited.json()).error).toMatch(/Слишком много попыток входа/);
    // Другой IP не затронут.
    const other = await login(post("/api/auth/login", { secret: SECRET }, sameOrigin, "198.51.100.78"));
    expect(other.status).toBe(200);
  });

  it("срабатывание лимита оставляет предупреждение в логе, без самого IP (N-03)", async () => {
    process.env.API_SECRET = SECRET;
    const ip = "198.51.100.91";
    for (let i = 0; i < 10; i++) {
      await login(post("/api/auth/login", { secret: "wrong" }, sameOrigin, ip));
    }

    const prev = process.env.LOG_IN_TESTS;
    process.env.LOG_IN_TESTS = "1";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const limited = await login(post("/api/auth/login", { secret: SECRET }, sameOrigin, ip));
      expect(limited.status).toBe(429);

      const line = warn.mock.calls
        .map((c) => String(c[0]))
        .find((s) => s.includes("auth.login_rate_limited"));
      expect(line).toBeTruthy();

      const event = JSON.parse(line as string) as Record<string, unknown>;
      expect(event.event).toBe("auth.login_rate_limited");
      expect(event.level).toBe("warn");
      expect(String(event.ipHash)).toMatch(/^[0-9a-f]{12}$/);
      // Ни сам адрес, ни секрет в строку лога не попадают.
      expect(line).not.toContain(ip);
      expect(line).not.toContain(SECRET);
    } finally {
      warn.mockRestore();
      if (prev === undefined) delete process.env.LOG_IN_TESTS;
      else process.env.LOG_IN_TESTS = prev;
    }
  });

  it("ответы на английском по cookie языка", async () => {
    process.env.API_SECRET = SECRET;
    const res = await login(post("/api/auth/login", { secret: "wrong" }, { ...sameOrigin, cookie: "ent_radar_lang=en" }, "198.51.100.9"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Wrong secret");
  });
});

describe("POST /api/auth/logout", () => {
  it("не same-origin → 403; same-origin → сброс cookie (Max-Age=0)", async () => {
    const foreign = await logout(post("/api/auth/logout", {}, { origin: "https://evil.example" }));
    expect(foreign.status).toBe(403);
    const res = await logout(post("/api/auth/logout", {}, sameOrigin));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const cookie = setCookie(res);
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=;`));
    expect(cookie).toMatch(/Max-Age=0/i);
  });
});

describe("GET /api/auth", () => {
  it("без API_SECRET — открыто", async () => {
    delete process.env.API_SECRET;
    const res = await authState(new NextRequest("http://app.example/api/auth"));
    expect(await res.json()).toEqual({ required: false, authenticated: true, session: false });
  });
});
