"use client";

import { Fragment, useMemo } from "react";
import { annotateAbbreviations, glossaryTitle } from "@/lib/evidence/glossary";

/**
 * Текст аннотации с подсветкой устойчивых сокращений (RCT, OR, 95% CI, SNHL…):
 * пунктирное подчёркивание, при наведении — русская расшифровка с пояснением.
 * Обычный текст не оборачивается ни во что — разметка не меняется.
 */
export function AbbrText({ text }: { text: string }) {
  const segments = useMemo(() => annotateAbbreviations(text), [text]);
  return (
    <>
      {segments.map((s, i) =>
        s.entry ? (
          <abbr
            key={i}
            title={glossaryTitle(s.entry)}
            className="cursor-help underline decoration-dotted decoration-slate-400 underline-offset-2 dark:decoration-slate-500"
          >
            {s.text}
          </abbr>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        ),
      )}
    </>
  );
}
