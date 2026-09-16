export default function Loading() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
        <p className="text-sm text-slate-500">Загрузка…</p>
      </div>
    </div>
  );
}
