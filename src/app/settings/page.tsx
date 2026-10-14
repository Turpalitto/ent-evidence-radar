import type { Metadata } from "next";
import { SettingsPanel } from "@/components/SettingsPanel";
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/metadata";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getI18n();
  return pageMetadata({
    title: t("Настройки"),
    description: t("Расписание автообновления, источники, темы мониторинга и прозрачная формула индекса доверия."),
    path: "/settings",
    locale,
  });
}

export default async function SettingsPage() {
  const { t } = await getI18n();
  return (
    <main className="space-y-5">
      <div className="rise-in">
        <p className="eyebrow">{t("Конфигурация")}</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-[color:var(--ink)]">{t("Настройки")}</h1>
        <p className="mt-1 text-sm text-[color:var(--ink-muted)]">{t("Расписание, источники, темы мониторинга и прозрачная формула индекса доверия.")}</p>
      </div>
      <SettingsPanel />
    </main>
  );
}
