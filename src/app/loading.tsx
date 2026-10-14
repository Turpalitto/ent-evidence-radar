import { getI18n } from "@/lib/i18n/server";

export default async function Loading() {
  const { t } = await getI18n();
  return (
    <div className="space-y-3" aria-busy="true" aria-label={t("Загрузка")}>
      <div className="space-y-2">
        <div className="skeleton h-6 w-72" />
        <div className="skeleton h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card rounded-2xl px-4 py-3.5">
            <div className="skeleton h-3 w-20" />
            <div className="skeleton mt-2 h-7 w-14" />
            <div className="skeleton mt-2 h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card rounded-2xl p-4">
            <div className="flex gap-3.5">
              <div className="skeleton h-12 w-12 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2 py-0.5">
                <div className="skeleton h-4 w-3/4" />
                <div className="skeleton h-3 w-full" />
                <div className="skeleton h-3 w-5/6" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
