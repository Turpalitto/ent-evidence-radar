import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkRateLimit, checkApiAuth, getClientIp } from "@/lib/security";
import { SESSION_COOKIE, createSessionToken, verifySessionToken } from "@/lib/session";

describe("checkRateLimit", () => {
  it("allows requests within limit", () => {
    const key = `test-${Date.now()}-1`;
    const r1 = checkRateLimit(key, 3, 1000);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = checkRateLimit(key, 3, 1000);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = checkRateLimit(key, 3, 1000);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it("blocks requests over limit", () => {
    const key = `test-${Date.now()}-2`;
    checkRateLimit(key, 2, 1000);
    checkRateLimit(key, 2, 1000);

    const r3 = checkRateLimit(key, 2, 1000);
    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
    expect(r3.resetMs).toBeGreaterThan(0);
  });
});

describe("checkApiAuth", () => {
  const SECRET = "test-secret-123";

  function req(headers: Record<string, string>, method = "POST") {
    return { method, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null } };
  }

  beforeEach(() => {
    process.env.API_SECRET = SECRET;
    delete process.env.SESSION_SECRET;
  });

  afterEach(() => {
    delete process.env.API_SECRET;
    delete process.env.SESSION_SECRET;
  });

  it("open access when API_SECRET is not set", () => {
    delete process.env.API_SECRET;
    expect(checkApiAuth(req({})).ok).toBe(true);
    expect(checkApiAuth(req({ origin: "https://evil.example" })).ok).toBe(true);
  });

  it("accepts Bearer token and X-API-Key", () => {
    expect(checkApiAuth(req({ authorization: `Bearer ${SECRET}` })).ok).toBe(true);
    expect(checkApiAuth(req({ "x-api-key": SECRET })).ok).toBe(true);
  });

  it("rejects wrong token", () => {
    const r = checkApiAuth(req({ authorization: "Bearer wrong" }));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });

  // Главный регрессионный тест аудита (F-01): заголовки, которые любой HTTP-клиент
  // выставляет произвольно, НЕ являются аутентификацией.
  it("REJECTS spoofed Sec-Fetch-Site: same-origin without token or session", () => {
    const r = checkApiAuth(req({ "sec-fetch-site": "same-origin", host: "app.example.com" }));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });

  it("REJECTS spoofed Origin equal to Host without token or session", () => {
    const r = checkApiAuth(req({ origin: "https://app.example.com", host: "app.example.com" }));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });

  it("rejects when neither token nor session present", () => {
    const r = checkApiAuth(req({ host: "app.example.com" }));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });

  describe("session cookie", () => {
    const cookie = () => `${SESSION_COOKIE}=${createSessionToken()}`;

    it("accepts a valid session cookie on a same-origin mutating request", () => {
      expect(checkApiAuth(req({ cookie: cookie(), "sec-fetch-site": "same-origin", host: "app.example.com" })).ok).toBe(true);
      expect(checkApiAuth(req({ cookie: cookie(), origin: "https://app.example.com", host: "app.example.com" })).ok).toBe(true);
    });

    it("accepts a valid session cookie on GET without origin headers (downloads/navigation)", () => {
      expect(checkApiAuth(req({ cookie: cookie(), host: "app.example.com" }, "GET")).ok).toBe(true);
    });

    it("REJECTS a mutating request with a valid cookie but cross-site origin (CSRF)", () => {
      const r1 = checkApiAuth(req({ cookie: cookie(), "sec-fetch-site": "cross-site", origin: "https://evil.example", host: "app.example.com" }));
      expect(r1.ok).toBe(false);
      expect(r1.status).toBe(403);
      const r2 = checkApiAuth(req({ cookie: cookie(), origin: "https://evil.example/app.example.com", host: "app.example.com" }));
      expect(r2.ok).toBe(false);
      const r3 = checkApiAuth(req({ cookie: cookie(), host: "app.example.com" }));
      expect(r3.ok).toBe(false);
    });

    it("rejects forged, tampered and expired tokens", () => {
      const forged = `${SESSION_COOKIE}=v1.9999999999.abc.notasignature`;
      expect(checkApiAuth(req({ cookie: forged, "sec-fetch-site": "same-origin", host: "a" })).ok).toBe(false);

      const valid = createSessionToken()!;
      const tampered = valid.replace(/^v1\.(\d+)/, (_m, exp: string) => `v1.${Number(exp) + 100000}`);
      expect(verifySessionToken(tampered)).toBe(false);

      const expired = createSessionToken(Date.now() - 400 * 24 * 3600 * 1000, 60)!;
      expect(verifySessionToken(expired)).toBe(false);
      expect(verifySessionToken("")).toBe(false);
      expect(verifySessionToken("v1.1.2")).toBe(false);
    });

    it("invalidates sessions when the secret changes", () => {
      const token = createSessionToken()!;
      expect(verifySessionToken(token)).toBe(true);
      process.env.API_SECRET = "another-secret";
      expect(verifySessionToken(token)).toBe(false);
    });

    it("cannot create a session when no secret is configured", () => {
      delete process.env.API_SECRET;
      expect(createSessionToken()).toBeNull();
    });
  });
});

describe("getClientIp", () => {
  function req(headers: Record<string, string>) {
    return { headers: { get: (n: string) => headers[n.toLowerCase()] ?? null } };
  }

  afterEach(() => {
    delete process.env.TRUST_PROXY;
    delete process.env.TRUSTED_PROXIES;
    delete process.env.CLIENT_IP_HEADER;
  });

  it("ignores proxy headers when TRUST_PROXY is not set (fail-safe)", () => {
    expect(getClientIp(req({ "x-forwarded-for": "1.2.3.4" }))).toBe("unknown");
    expect(getClientIp(req({ "x-real-ip": "5.6.7.8" }))).toBe("unknown");
  });

  it("takes the rightmost XFF entry (closest to the app), not the client-spoofed leftmost", () => {
    process.env.TRUST_PROXY = "1";
    expect(getClientIp(req({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("strips the port and IPv4-mapped prefix", () => {
    process.env.TRUST_PROXY = "1";
    expect(getClientIp(req({ "x-forwarded-for": "203.0.113.9:5555" }))).toBe("203.0.113.9");
    expect(getClientIp(req({ "x-forwarded-for": "::ffff:203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("skips trusted proxy hops via CIDR", () => {
    process.env.TRUST_PROXY = "1";
    process.env.TRUSTED_PROXIES = "10.0.0.0/8";
    expect(getClientIp(req({ "x-forwarded-for": "203.0.113.9, 10.1.2.3" }))).toBe("203.0.113.9");
  });

  it("prefers an explicitly configured CLIENT_IP_HEADER", () => {
    process.env.TRUST_PROXY = "1";
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip";
    expect(getClientIp(req({ "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "1.2.3.4" }))).toBe("198.51.100.7");
  });
});
