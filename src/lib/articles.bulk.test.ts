import { describe, it, expect } from "vitest";
import { inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { POST } from "@/app/api/articles/bulk/route";

const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/articles/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("POST /api/articles/bulk (I-14)", () => {
  it("помечает несколько статей прочитанными; валидация тела", async () => {
    const rows = await db
      .insert(articles)
      .values(
        [1, 2, 3].map((i) => ({ dedupKey: `bulk-${i}`, title: `Bulk ${i}`, sourceKey: "pubmed", sourceKeys: ["pubmed"], url: "https://e.org", pmid: `6000000${i}` })),
      )
      .returning({ id: articles.id });
    const ids = rows.map((r) => r.id);
    const res = await post({ ids: [...ids.slice(0, 2), 999_999], isRead: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(2);
    const after = await db.select({ id: articles.id, isRead: articles.isRead }).from(articles).where(inArray(articles.id, ids));
    expect(after.filter((a) => a.isRead).map((a) => a.id).sort()).toEqual(ids.slice(0, 2).sort());

    expect((await post({ ids })).status).toBe(400); // нет полей
    expect((await post({ ids: [], isRead: true })).status).toBe(400);
    expect((await post({ ids: Array.from({ length: 201 }, (_, i) => i + 1), isRead: true })).status).toBe(400);
  });
});
