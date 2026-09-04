import { SettingsPanel } from "@/components/SettingsPanel";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <main className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Настройки</h1>
        <p className="text-sm text-slate-500">Расписание, источники, темы мониторинга и прозрачная формула индекса доверия.</p>
      </div>
      <SettingsPanel />
    </main>
  );
}
