"use client";

import type { ReactNode } from "react";

/** Карточка-секция настроек: hairline + мягкая тень, единый вертикальный ритм. */
export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card rounded-2xl p-5">
      <h2 className="text-base font-semibold text-[color:var(--ink)]">{title}</h2>
      {hint && <p className="mt-1 mb-4 text-sm text-[color:var(--ink-muted)]">{hint}</p>}
      {children}
    </section>
  );
}

/** Общие классы полей формы настроек. */
export const FIELD = "panel rounded-xl p-3.5";
export const INPUT = "field mt-1 w-full rounded-lg px-2.5 py-1.5 text-sm text-[color:var(--ink)]";
