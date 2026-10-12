import type { Metadata } from "next";
import { SettingsPanel } from "@/components/SettingsPanel";
import { pageMetadata } from "@/lib/metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Настройки",
  description: "Расписание автообновления, источники, темы мониторинга и прозрачная формула индекса доверия.",
  path: "/settings",
});

export default function SettingsPage() {
  return (
    <main className="space-y-5">
      <div className="rise-in">
        <p className="eyebrow">Конфигурация</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-[color:var(--ink)]">Настройки</h1>
        <p className="mt-1 text-sm text-[color:var(--ink-muted)]">Расписание, источники, темы мониторинга и прозрачная формула индекса доверия.</p>
      </div>
      <SettingsPanel />
    </main>
  );
}
