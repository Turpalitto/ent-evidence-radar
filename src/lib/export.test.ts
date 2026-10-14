import { describe, it, expect } from "vitest";
import { csvEscape, csvRow } from "@/lib/export";

describe("csvEscape (F-20: защита от CSV-инъекций)", () => {
  it("экранирует кавычки и оборачивает значение", () => {
    expect(csvEscape('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvEscape(null)).toBe('""');
    expect(csvEscape(undefined)).toBe('""');
    expect(csvEscape(42)).toBe('"42"');
  });

  it("нейтрализует ячейки, которые Excel/LibreOffice исполнили бы как формулу", () => {
    expect(csvEscape('=HYPERLINK("http://evil","click")')).toBe('"\'=HYPERLINK(""http://evil"",""click"")"');
    expect(csvEscape("+1+1")).toBe("\"'+1+1\"");
    expect(csvEscape("-2+3")).toBe("\"'-2+3\"");
    expect(csvEscape("@SUM(A1)")).toBe("\"'@SUM(A1)\"");
    expect(csvEscape("\t=cmd|' /C calc'!A0")).toBe("\"'\t=cmd|' /C calc'!A0\"");
    expect(csvEscape("\r=1")).toBe("\"'\r=1\"");
  });

  it("не трогает обычный текст, включая знаки внутри строки", () => {
    expect(csvEscape("Dupilumab vs placebo: n = 120")).toBe('"Dupilumab vs placebo: n = 120"');
    expect(csvEscape("10.1002/lary.12345")).toBe('"10.1002/lary.12345"');
  });

  it("csvRow собирает строку", () => {
    expect(csvRow([1, "a,b", "=x"])).toBe('"1","a,b","\'=x"');
  });
});
