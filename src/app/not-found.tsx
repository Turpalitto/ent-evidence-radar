import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";

export default async function NotFound() {
  const { t } = await getI18n();
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center text-center">
      <div className="card rise-in w-full rounded-2xl px-6 py-10">
        <div
          className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl"
          style={{ background: "var(--brand-soft)" }}
        >
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: "var(--brand-a)" }}>
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </div>
        <p className="brand-gradient-text text-5xl font-bold tracking-tight">404</p>
        <h1 className="mt-2 text-lg font-semibold text-[color:var(--ink)]">{t("Страница не найдена")}</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[color:var(--ink-muted)]">
          {t("Возможно, ссылка устарела или содержит опечатку. Вернитесь к ленте публикаций — там всё свежее.")}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Link href="/" className="btn-brand rounded-xl px-4 py-2 text-sm font-semibold text-white">
            {t("К ленте")}
          </Link>
          <Link href="/stats" className="btn-ghost rounded-xl px-4 py-2 text-sm font-semibold">
            {t("Аналитика")}
          </Link>
        </div>
      </div>
    </main>
  );
}
