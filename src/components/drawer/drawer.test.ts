import { describe, expect, it } from "vitest";
import { createI18n } from "@/lib/i18n";
import { makeArticle } from "@/test/fixtures";
import { buildConsiliumSummary, picoFor, sectionHeader } from "./consilium";
import { consumeSseDeltas } from "./sse";

/** Поток дельт из фрагментов произвольной нарезки (как их отдаёт сеть). */
function stream(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === "string" ? enc.encode(c) : c);
      controller.close();
    },
  });
}

async function collect(chunks: (string | Uint8Array)[]) {
  const deltas: string[] = [];
  await consumeSseDeltas(stream(chunks), (d) => deltas.push(d), "fallback");
  return deltas;
}

describe("consumeSseDeltas", () => {
  it("склеивает строки, разрезанные между фрагментами, пропускает комментарии и пустые строки, читает хвост без перевода строки", async () => {
    const deltas = await collect([
      ': keep-alive\n\ndata: {"ok":true,"del',
      'ta":"Hel"}\n\ndata: {"ok":true,"delta":"lo"}\ndata: {"ok":true,"delta":" wor"}\n',
      'data: {"ok":true,"delta":"ld"}',
    ]);
    expect(deltas).toEqual(["Hel", "lo", " wor", "ld"]);
  });

  it("многобайтовая кириллица, разрезанная посередине символа, декодируется целиком", async () => {
    const bytes = new TextEncoder().encode('data: {"ok":true,"delta":"Привет"}\n');
    const cut = 20; // внутри UTF-8 последовательности
    const deltas = await collect([bytes.slice(0, cut), bytes.slice(cut)]);
    expect(deltas).toEqual(["Привет"]);
  });

  it("невалидный JSON и события без delta пропускаются; ошибка сервера прерывает поток", async () => {
    expect(await collect(['data: not-json\n', 'data: {"ok":true}\n', 'data: {"ok":true,"delta":"x"}\n'])).toEqual(["x"]);
    await expect(collect(['data: {"ok":true,"delta":"a"}\n', 'data: {"ok":false,"error":"Бюджет исчерпан"}\n', 'data: {"ok":true,"delta":"b"}\n'])).rejects.toThrow("Бюджет исчерпан");
    await expect(collect(['data: {"ok":false}\n'])).rejects.toThrow("fallback");
  });
});

describe("buildConsiliumSummary / sectionHeader / picoFor", () => {
  const ru = createI18n("ru");
  const en = createI18n("en");

  it("текст для консилиума: ссылка, дизайн/уровень/доверие, n, PICO, вывод, источник", () => {
    const a = makeArticle({
      id: 1,
      title: "Dupilumab versus placebo in adults with chronic rhinosinusitis with nasal polyps",
      abstract: "BACKGROUND: Biologics are promising. METHODS: We randomized 276 adults with CRSwNP to dupilumab or placebo. RESULTS: Polyp score improved. CONCLUSIONS: Dupilumab reduces polyp burden.",
      studyDesign: "rct",
      evidenceLevel: 2,
      trustScore: 88,
      sampleSize: 276,
      publishedAt: new Date("2026-03-01"),
    });
    const text = buildConsiliumSummary(a, ru);
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^📄 Smith J, Lee K\./);
    expect(lines[1]).toBe("📊 Дизайн: РКИ (Уровень 2 — РКИ / крупные когорты), Индекс доверия: 88/100, n≈276");
    expect(lines[2]).toMatch(/^🧩 PICO — P: .*CRSwNP/);
    expect(lines[2]).toMatch(/I: dupilumab/i);
    expect(lines[3]).toBe("💡 Вывод: Dupilumab reduces polyp burden.");
    expect(lines[4]).toBe(`🔗 Источник: ${a.url}`);

    const english = buildConsiliumSummary(a, en);
    expect(english).toMatch(/^📊 Design: RCT \(Level 2/m);
    expect(english).not.toMatch(/[\u0400-\u04FF]/);
  });

  it("для руководств и записей реестра PICO не извлекается; заголовки секций — по локали", () => {
    expect(picoFor({ studyDesign: "guideline", abstract: "PATIENTS: adults. INTERVENTION: x. OUTCOME: y.", title: "" })).toBeNull();
    expect(picoFor({ studyDesign: "trial_registry", abstract: "PATIENTS: adults.", title: "" })).toBeNull();
    expect(picoFor({ studyDesign: "rct", abstract: "PATIENTS: 40 adults with otitis. INTERVENTION: tubes. COMPARISON: watchful waiting. OUTCOMES: hearing.", title: "" })).toMatchObject({ source: "structured" });
    expect(sectionHeader("en", "BACKGROUND")).toBe("Background");
    expect(sectionHeader("en", " MAIN OUTCOME MEASURES ")).toBe("Main outcome measures");
    expect(sectionHeader("ru", "BACKGROUND")).toBe("Введение и актуальность");
    expect(sectionHeader("ru", "SOMETHING ODD")).toBe("SOMETHING ODD");
  });
});
