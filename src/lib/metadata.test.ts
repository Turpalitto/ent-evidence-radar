import { describe, expect, it } from "vitest";
import { ogImage, pageMetadata } from "./metadata";

/**
 * Метаданные страниц: `openGraph`/`twitter` в Next заменяются целиком, поэтому помощник
 * обязан задавать их полностью; язык меняет OG-locale и alt картинки.
 */
describe("pageMetadata", () => {
  it("обычная страница: заголовок по шаблону, canonical, Atom alternate, полные OG/Twitter", () => {
    const m = pageMetadata({ title: "Статистика", description: "Опис.", path: "/stats" });
    expect(m.title).toBe("Статистика");
    expect(m.alternates).toEqual({ canonical: "/stats", types: { "application/atom+xml": "/feed.xml" } });
    expect(m.openGraph).toMatchObject({ title: "Статистика · ENT Evidence Radar", url: "/stats", siteName: "ENT Evidence Radar", locale: "ru_RU", type: "website" });
    expect(m.twitter).toMatchObject({ card: "summary_large_image", title: "Статистика · ENT Evidence Radar", description: "Опис." });
    const images = (m.openGraph as { images: unknown[] }).images;
    expect(images).toEqual([ogImage("ru")]);
    expect((images[0] as { alt: string }).alt).toMatch(/оториноларингологии/);
  });

  it("главная: абсолютный заголовок без суффикса; английский язык — en_GB и английский alt", () => {
    const m = pageMetadata({ title: "x", absolute: "ENT Evidence Radar", description: "d", path: "/", locale: "en" });
    expect(m.title).toEqual({ absolute: "ENT Evidence Radar" });
    expect(m.openGraph).toMatchObject({ title: "ENT Evidence Radar", locale: "en_GB" });
    expect(ogImage("en")).toMatchObject({ url: "/og.png", width: 1200, height: 630, alt: expect.stringMatching(/^ENT Evidence Radar — .*otolaryngology/) });
    expect(ogImage("en").alt).not.toMatch(/[\u0400-\u04FF]/);
  });
});
