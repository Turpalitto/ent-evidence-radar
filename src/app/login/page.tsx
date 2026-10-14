import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/metadata";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getI18n();
  return {
    ...pageMetadata({
      title: t("Вход"),
      description: t("Вход в режим редактирования ENT Evidence Radar."),
      path: "/login",
      locale,
    }),
    robots: { index: false, follow: false },
  };
}

export default async function LoginPage() {
  const { t } = await getI18n();
  return (
    <main className="mx-auto max-w-md space-y-5">
      <div className="rise-in">
        <p className="eyebrow">{t("Доступ")}</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-[color:var(--ink)]">{t("Вход")}</h1>
        <p className="mt-1 text-sm text-[color:var(--ink-muted)]">
          {t("Чтение ленты открыто всем. Изменение настроек, тем, заметок и запуск обновления требуют входа.")}
        </p>
      </div>
      <Suspense fallback={<div className="skeleton h-40 rounded-2xl" />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
