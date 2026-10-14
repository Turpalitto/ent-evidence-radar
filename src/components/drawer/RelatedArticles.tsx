"use client";

import { useEffect, useState } from "react";
import type { Article } from "@/db/schema";
import { useI18n } from "@/lib/i18n/client";
import { DesignBadge, TrustScore } from "../Badges";

/** «Похожие публикации»: подгружаются по id открытой статьи; поздний ответ прежней статьи отбрасывается. */
export function RelatedArticles({ articleId, onSelect }: { articleId: number; onSelect: (a: Article) => void }) {
  const { t, date } = useI18n();
  // Результат хранится вместе с id, для которого он получен: «загрузка» = ответ ещё не для текущей статьи.
  const [result, setResult] = useState<{ forId: number; items: Article[] } | null>(null);
  const loading = result?.forId !== articleId;
  const related = loading ? [] : result.items;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/articles/${articleId}/related`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data: { items?: Article[] }) => { if (!cancelled) setResult({ forId: articleId, items: data.items ?? [] }); })
      .catch(() => { if (!cancelled) setResult({ forId: articleId, items: [] }); });
    return () => { cancelled = true; };
  }, [articleId]);

  if (!loading && related.length === 0) return null;
  return (
    <section>
      <p className="mb-2 eyebrow">{t("Похожие публикации")}</p>
      {loading && <p className="text-xs text-slate-400">{t("Поиск…")}</p>}
      {!loading && related.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {related.map((rel) => (
            <div
              key={rel.id}
              onClick={() => onSelect(rel)}
              className="panel group cursor-pointer rounded-xl p-3 transition hover:border-[color:var(--brand-ring)] active:scale-[0.98]"
            >
              <div className="mb-1 flex items-center gap-1.5">
                <DesignBadge design={rel.studyDesign} />
                <TrustScore score={rel.trustScore} size="sm" />
              </div>
              <p className="line-clamp-2 text-xs font-medium text-[color:var(--ink)] transition-colors group-hover:text-[color:var(--brand-ink)]">{rel.title}</p>
              <p className="mt-1 truncate text-[11px] text-[color:var(--ink-subtle)]">{rel.journal || "—"} · {date(rel.publishedAt)}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
