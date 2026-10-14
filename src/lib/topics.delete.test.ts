import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { articles, topics } from "@/db/schema";
import { DELETE } from "@/app/api/topics/[id]/route";

describe("DELETE /api/topics/:id (F-29)", () => {
  it("удаляет тему и отвязывает её id от статей, не трогая остальные темы", async () => {
    const [t] = await db.insert(topics).values({ name: "Удаляемая", query: "q", subspecialty: "general" }).returning();
    const [a] = await db
      .insert(articles)
      .values({ dedupKey: `del-${t.id}`, title: "A", sourceKey: "pubmed", sourceKeys: ["pubmed"], url: "https://e.org", topicIds: [t.id, 999] })
      .returning();
    const res = await DELETE(new NextRequest(`http://localhost/api/topics/${t.id}`, { method: "DELETE" }), { params: Promise.resolve({ id: String(t.id) }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, detachedArticles: 1 });
    const [after] = await db.select({ topicIds: articles.topicIds }).from(articles).where(eq(articles.id, a.id));
    expect(after.topicIds).toEqual([999]);
    expect(await db.select().from(topics).where(eq(topics.id, t.id))).toHaveLength(0);
  });
});
