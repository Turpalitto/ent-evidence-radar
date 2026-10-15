import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Страж CSP/корреляционного id (proxy — конвенция Next.js 16 вместо middleware).
 * `CSP_ENABLED` читается при импорте модуля, поэтому каждый сценарий импортирует его заново.
 */
async function load(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v as string);
  return import("./proxy");
}

const req = (path = "/", headers: Record<string, string> = {}) => new NextRequest(`http://localhost${path}`, { headers });

/** Заголовки, которые proxy прокинул дальше в приложение (NextResponse.next({ request })). */
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

afterEach(() => vi.unstubAllEnvs());

describe("proxy: CSP с nonce и x-request-id", () => {
  it("ставит CSP с nonce в ответ и в заголовки запроса (Next подхватывает его для своих <script>)", async () => {
    const { proxy } = await load({ DISABLE_CSP: "" });
    const res = proxy(req("/"));
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    // Тот же nonce — в заголовках запроса для сервера
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    expect(forwarded(res, "x-nonce")).toBe(nonce);
    expect(forwarded(res, "content-security-policy")).toBe(csp);
    // nonce уникален на каждый запрос
    expect(proxy(req("/")).headers.get("content-security-policy")).not.toBe(csp);
  });

  it("'unsafe-eval' только вне production", async () => {
    const dev = await load({ DISABLE_CSP: "", NODE_ENV: "development" });
    expect(dev.proxy(req("/")).headers.get("content-security-policy")).toContain("'unsafe-eval'");
    const prod = await load({ DISABLE_CSP: "", NODE_ENV: "production" });
    expect(prod.proxy(req("/")).headers.get("content-security-policy")).not.toContain("'unsafe-eval'");
  });

  it("DISABLE_CSP=1 — без CSP, но x-request-id по-прежнему проставляется", async () => {
    const { proxy } = await load({ DISABLE_CSP: "1" });
    const res = proxy(req("/api/articles"));
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(forwarded(res, "x-request-id")).toBe(res.headers.get("x-request-id"));
  });

  it("x-request-id: безопасный id от прокси принимается, мусор/слишком короткий — заменяется на UUID", async () => {
    const { proxy } = await load({ DISABLE_CSP: "" });
    expect(proxy(req("/", { "x-request-id": "lb-2026.10.15:abc-12345" })).headers.get("x-request-id")).toBe("lb-2026.10.15:abc-12345");
    expect(proxy(req("/", { "x-request-id": "short" })).headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(proxy(req("/", { "x-request-id": "bad id with spaces<script>" })).headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(proxy(req("/", { "x-request-id": "x".repeat(129) })).headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("matcher: документы и API — да, статика Next, favicon и шрифты/картинки — нет", async () => {
    const { config } = await load({ DISABLE_CSP: "" });
    const [pattern] = config.matcher;
    const re = new RegExp(`^${pattern.replace(/\/:path\*/g, "(/.*)?")}$`);
    for (const p of ["/", "/stats", "/api/articles", "/feed.xml", "/settings"]) expect(p, p).toMatch(re);
    for (const p of ["/_next/static/chunks/main.js", "/_next/image?url=x", "/favicon.ico", "/fonts/inter.woff2", "/og.png", "/icons/icon.svg"]) expect(p, p).not.toMatch(re);
  });
});
