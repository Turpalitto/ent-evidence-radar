import type { I18n } from "@/lib/i18n";

/** Размер в байтах → человекочитаемая строка (Б/КБ/МБ/ГБ) на языке интерфейса. */
export function fmtBytes(n: number, t: I18n["t"]): string {
  if (n < 1024) return t("{n} Б", { n });
  if (n < 1024 ** 2) return t("{n} КБ", { n: (n / 1024).toFixed(1) });
  if (n < 1024 ** 3) return t("{n} МБ", { n: (n / 1024 ** 2).toFixed(1) });
  return t("{n} ГБ", { n: (n / 1024 ** 3).toFixed(2) });
}

/** Аптайм в секундах → «d д h ч» / «h ч m мин» / «m мин». */
export function fmtDuration(sec: number, t: I18n["t"]): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? t("{d} д {h} ч", { d, h }) : h ? t("{h} ч {m} мин", { h, m }) : t("{m} мин", { m });
}
