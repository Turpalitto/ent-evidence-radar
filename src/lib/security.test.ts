import { describe, it, expect } from "vitest";
import { checkRateLimit } from "@/lib/security";

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
