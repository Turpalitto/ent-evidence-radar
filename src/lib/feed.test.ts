import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { articles, topics } from "@/db/schema";
import { ensureSeeded } from "@/lib/refresh";
import { GET } from "@/app/feed.xml/route";
import { describeFeedFilters, feedFilters } from "./feed";

const get = (qs = "") => GET(new NextRequest(`http://localhost/feed.xml${qs}`));

describe("/feed.xml с фильтрами (подписка на сохранённый поиск)", () => {
  beforeAll(async () => {
    await ensureSeeded();
    const [t] = await db.select({ id: topics.id }).from(topics).limit(1);
    await db.insert(articles).values([
      { dedupKey: "feed-1", title: "Feed rhinology RCT", sourceKey: "pubmed", sourceKeys: ["pubmed"], url: "https://e.org/1", pmid: "80000001", subspecialties: ["rhinology"], studyDesign: "rct", evidenceLevel: 2, trustScore: 80, topicIds: [t.id] },
      { dedupKey: "feed-2", title: "Feed otology cohort", sourceKey: "pubmed", sourceKeys: ["pubmed"], url: "https://e.org/2", pmid: "80000002", subspecialties: ["otology"], studyDesign: "cohort", evidenceLevel: 3, trustScore: 40 },
      { dedupKey: "feed-3", title: "Feed hidden rhinology", sourceKey: "pubmed", sourceKeys: ["pubmed"], url: "https://e.org/3", pmid: "80000003", subspecialties: ["rhinology"], studyDesign: "rct", trustScore: 90, isHidden: true },
      { dedupKey: "feed-4", title: "Feed bookmarked otology", sourceKey: "pubmed", sourceKeys: ["pubmed"], url: "https://e.org/4", pmid: "80000004", subspecialties: ["otology"], studyDesign: "rct", trustScore: 70, isBookmarked: true },
    ]);
  });

  it("без параметров — все нескрытые записи, заголовок общий", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/atom+xml");
    const xml = await res.text();
    expect(xml).toContain("<title>ENT Evidence Radar — лента доказательных публикаций</title>");
    expect(xml).toContain("Feed rhinology RCT");
    expect(xml).toContain("Feed otology cohort");
    expect(xml).not.toContain("Feed hidden rhinology");
    expect(xml).toContain('rel="self"');
  });

  it("фильтры сужают выборку и попадают в заголовок, self-ссылку и ссылку на сайт", async () => {
    const xml = await (await get("?subspecialty=rhinology&design=rct&minTrust=70")).text();
    expect(xml).toContain("Feed rhinology RCT");
    expect(xml).not.toContain("Feed otology cohort");
    expect(xml).not.toContain("Feed hidden rhinology");
    expect(xml).toContain("<title>ENT Evidence Radar — Ринология / аллергология · РКИ · доверие ≥ 70</title>");
    expect(xml).toMatch(/<link href="[^"]*\/feed\.xml\?subspecialty=rhinology&amp;design=rct&amp;minTrust=70" rel="self"/);
    expect(xml).toMatch(/<link href="[^"]*\/\?subspecialty=rhinology&amp;design=rct&amp;minTrust=70" rel="alternate"/);
  });

  it("персональные флаги игнорируются: bookmarked/unread/hidden не влияют на публичную ленту", async () => {
    const xml = await (await get("?bookmarked=1&hidden=1&unread=1&subspecialty=otology")).text();
    expect(xml).toContain("Feed otology cohort"); // не закладка — всё равно в ленте
    expect(xml).toContain("Feed bookmarked otology");
    expect(xml).not.toContain("Feed hidden rhinology");
    expect(xml).not.toContain("bookmarked=1");
  });

  it("тема попадает в заголовок по имени", async () => {
    const [t] = await db.select({ id: topics.id, name: topics.name }).from(topics).limit(1);
    const xml = await (await get(`?topicId=${t.id}`)).text();
    expect(xml).toContain(`тема «${t.name}»`);
    expect(xml).toContain("Feed rhinology RCT");
    expect(xml).not.toContain("Feed otology cohort");
  });

  it("feedFilters/describeFeedFilters: сортировка по сбору без запроса, по релевантности с запросом", () => {
    const a = feedFilters(new URLSearchParams("days=30&excludePreprints=1&fromYear=2024"));
    expect(a.sort).toBe("fetched");
    expect(a.pageSize).toBe(60);
    expect(describeFeedFilters(a)).toEqual(["за 30 дн.", "с 2024", "без препринтов"]);
    const b = feedFilters(new URLSearchParams("q=tinnitus&level=2"));
    expect(b.sort).toBe("relevance");
    expect(describeFeedFilters(b)).toEqual(["уровень ≤ 2", "поиск «tinnitus»"]);
  });
});
