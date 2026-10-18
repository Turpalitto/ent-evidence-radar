import { describe, it, expect } from "vitest";
import { createI18n } from "@/lib/i18n";
import { fmtBytes, fmtDuration } from "./format";

const ru = createI18n("ru").t;
const en = createI18n("en").t;

describe("settings/format", () => {
  it("fmtBytes: границы единиц и округление, на обоих языках", () => {
    expect(fmtBytes(0, ru)).toBe("0 Б");
    expect(fmtBytes(1023, ru)).toBe("1023 Б");
    expect(fmtBytes(1024, ru)).toBe("1.0 КБ");
    expect(fmtBytes(1536, ru)).toBe("1.5 КБ");
    expect(fmtBytes(5 * 1024 ** 2, ru)).toBe("5.0 МБ");
    expect(fmtBytes(1.25 * 1024 ** 3, ru)).toBe("1.25 ГБ");
    expect(fmtBytes(2048, en)).toBe("2.0 KB");
    expect(fmtBytes(3 * 1024 ** 3, en)).toBe("3.00 GB");
  });

  it("fmtDuration: минуты, часы с минутами, дни с часами", () => {
    expect(fmtDuration(0, ru)).toBe("0 мин");
    expect(fmtDuration(59, ru)).toBe("0 мин");
    expect(fmtDuration(61, ru)).toBe("1 мин");
    expect(fmtDuration(3600 + 5 * 60, ru)).toBe("1 ч 5 мин");
    expect(fmtDuration(86400 + 2 * 3600 + 59 * 60, ru)).toBe("1 д 2 ч");
    expect(fmtDuration(90, en)).toBe("1 min");
    expect(fmtDuration(2 * 86400, en)).toBe("2 d 0 h");
  });
});
