import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { PATCH, DELETE } from "@/app/api/articles/[id]/route";
import { listArticles } from "@/lib/queries";
import { exportUserData, restoreUserData } from "@/lib/backup";

async function seed(title: string, pmid: string) {
  const [a] = await db
    .insert(articles)
    .values({
      dedupKey: `pmid:${pmid}`,
      pmid,
      title,
      abstract: "We enrolled 240 patients in this randomized controlled trial of tympanostomy tubes. ".padEnd(300, "x"),
      journal: "The Laryngoscope",
      publicationTypes: ["Randomized Controlled Trial"],
      sourceKey: "pubmed",
      sourceKeys: ["pubmed"],
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      studyDesign: "rct",
      evidenceLevel: 2,
      trustScore: 80,
      subspecialties: ["otology", "pediatric"],
    })
    .returning();
  return a;
}

const req = (method: string, body?: unknown, qs = "") =>
  new NextRequest(`http://localhost/api/articles/1${qs}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

describe("ручные правки классификации и скрытие (A-11)", () => {
  it("PATCH overrides переклассифицирует запись; null — сбрасывает к автоматике", async () => {
    const a = await seed("Tympanostomy tubes RCT", "50000001");
    let res = await PATCH(req("PATCH", { overrides: { studyDesign: "case_series", subspecialties: ["rhinology", "bogus"] } }), ctx(a.id));
    expect(res.status).toBe(200);
    let body = await res.json();
    expect(body.studyDesign).toBe("case_series");
    expect(body.evidenceLevel).toBe(4);
    expect(body.subspecialties).toEqual(["rhinology"]);
    expect(body.overrides.studyDesign).toBe("case_series");
    expect(body.overrides.at).toBeTruthy();
    expect(body.trustScore).toBeLessThan(80);

    res = await PATCH(req("PATCH", { overrides: null }), ctx(a.id));
    body = await res.json();
    expect(body.overrides).toEqual({});
    expect(body.studyDesign).toBe("rct"); // эвристика по типу публикации
    expect(body.subspecialties).toContain("otology");

    res = await PATCH(req("PATCH", { overrides: "rct" }), ctx(a.id));
    expect(res.status).toBe(400);
  });

  it("DELETE скрывает запись (не удаляет), она исчезает из ленты и видна в режиме hidden=1; ?purge=1 удаляет", async () => {
    const a = await seed("Hidden candidate", "50000002");
    const res = await DELETE(req("DELETE"), ctx(a.id));
    expect(await res.json()).toEqual({ ok: true, hidden: true, purged: false });
    const [row] = await db.select().from(articles).where(eq(articles.id, a.id));
    expect(row.isHidden).toBe(true);

    const visible = await listArticles({ q: "Hidden candidate", page: 1, pageSize: 10 });
    expect(visible.items.find((x) => x.id === a.id)).toBeUndefined();
    const hidden = await listArticles({ hidden: true, page: 1, pageSize: 10 });
    expect(hidden.items.map((x) => x.id)).toContain(a.id);

    const back = await PATCH(req("PATCH", { isHidden: false }), ctx(a.id));
    expect((await back.json()).isHidden).toBe(false);

    const purge = await DELETE(req("DELETE", undefined, "?purge=1"), ctx(a.id));
    expect(await purge.json()).toEqual({ ok: true, hidden: false, purged: true });
    expect(await db.select().from(articles).where(eq(articles.id, a.id))).toHaveLength(0);
  });

  it("бэкап содержит скрытие и правки; восстановление применяет их к статье без локальных правок", async () => {
    const a = await seed("Backup overrides", "50000003");
    await PATCH(req("PATCH", { overrides: { studyDesign: "narrative" }, isHidden: true }), ctx(a.id));
    const dump = await exportUserData();
    const item = dump.bookmarksAndNotes.find((b) => b.pmid === "50000003");
    expect(item?.isHidden).toBe(true);
    expect(item?.overrides?.studyDesign).toBe("narrative");

    // «Переезд»: та же статья в новой базе без правок
    await db.update(articles).set({ isHidden: false, overrides: {}, studyDesign: "rct", evidenceLevel: 2 }).where(eq(articles.id, a.id));
    const r = await restoreUserData(JSON.parse(JSON.stringify(dump)));
    expect(r.articles.overridesApplied).toBe(1);
    const [row] = await db.select().from(articles).where(eq(articles.id, a.id));
    expect(row.isHidden).toBe(true);
    expect(row.studyDesign).toBe("narrative");
    expect(row.overrides.studyDesign).toBe("narrative");
  });
});
