"use client";

import { useRef } from "react";
import { msg } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { useFocusTrap } from "../useFocusTrap";

const SHORTCUTS: { label: string; keys: string }[] = [
  { label: msg("Следующая статья"), keys: "j / ↓" },
  { label: msg("Предыдущая статья"), keys: "k / ↑" },
  { label: msg("Открыть подробности"), keys: "Enter" },
  { label: msg("В избранное / из избранного"), keys: "b" },
  { label: msg("Прочитано / непрочитано"), keys: "r" },
  { label: msg("Закрыть / сбросить фокус"), keys: "Esc" },
  { label: msg("Справка по клавишам"), keys: "?" },
];

/** Справка по горячим клавишам ленты: модальное окно с удержанием фокуса, закрывается кликом по фону. */
export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={t("Горячие клавиши")} tabIndex={-1} className="card overlay-enter w-full max-w-sm rounded-2xl p-5 shadow-[var(--shadow-modal)] outline-none" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-[color:var(--ink)]">{t("Горячие клавиши")}</h3>
          <button onClick={onClose} aria-label={t("Закрыть")} className="rounded-lg p-1.5 text-[color:var(--ink-subtle)] hover:bg-[color:var(--surface-3)] hover:text-[color:var(--ink)]">✕</button>
        </div>
        <ul className="space-y-2 text-sm">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between">
              <span className="text-[color:var(--ink-soft)]">{t(s.label)}</span>
              <kbd className="rounded bg-[color:var(--surface-3)] px-2 py-0.5 font-mono text-xs text-[color:var(--ink-soft)]">{s.keys}</kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
