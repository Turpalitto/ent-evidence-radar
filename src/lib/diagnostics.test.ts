import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { collectDiagnostics, forceReleaseLock } from "@/lib/diagnostics";
import { GET, POST } from "@/app/api/admin/diagnostics/route";

describe("диагностика администратора (A-12)", () => {
  it("collectDiagnostics собирает сводку без утечки секретов", async () => {
    process.env.NCBI_API_KEY = "secret-key";
    const d = await collectDiagnostics();
    expect(d.app.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(d.db.kind).toBe("pglite");
    expect(typeof d.db.counts.articles).toBe("number");
    expect(d.env.NCBI_API_KEY).toBe(true);
    expect(JSON.stringify(d)).not.toContain("secret-key");
    expect(d.sources.length).toBeGreaterThan(0);
    expect(d.scheduler).toHaveProperty("started");
    delete process.env.NCBI_API_KEY;
  });

  it("GET без авторизации при заданном API_SECRET — 401; release_lock снимает чужую просроченную/зависшую блокировку", async () => {
    process.env.API_SECRET = "s3cret";
    try {
      const res = await GET(new NextRequest("http://localhost/api/admin/diagnostics"));
      expect(res.status).toBe(401);
      await db
        .insert(settings)
        .values({ key: "lock_refresh", value: { holder: "dead-process", expiresAt: new Date(Date.now() + 300_000).toISOString() } })
        .onConflictDoUpdate({ target: settings.key, set: { value: { holder: "dead-process", expiresAt: new Date(Date.now() + 300_000).toISOString() } } });
      const authed = await GET(new NextRequest("http://localhost/api/admin/diagnostics", { headers: { authorization: "Bearer s3cret" } }));
      expect(authed.status).toBe(200);
      const body = await authed.json();
      expect(body.lock?.holder).toBe("dead-process");
      expect(body.lock.leaseSecLeft).toBeGreaterThan(0);

      const bad = await POST(new NextRequest("http://localhost/api/admin/diagnostics", { method: "POST", headers: { authorization: "Bearer s3cret", "content-type": "application/json" }, body: JSON.stringify({ action: "nope" }) }));
      expect(bad.status).toBe(400);
      const rel = await POST(new NextRequest("http://localhost/api/admin/diagnostics", { method: "POST", headers: { authorization: "Bearer s3cret", "content-type": "application/json" }, body: JSON.stringify({ action: "release_lock" }) }));
      expect(rel.status).toBe(200);
      expect((await collectDiagnostics()).lock).toBeNull();
      expect(await forceReleaseLock()).toBe(false); // уже нечего снимать
    } finally {
      delete process.env.API_SECRET;
    }
  });
});
