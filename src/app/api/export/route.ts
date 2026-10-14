import { NextRequest, NextResponse } from "next/server";
import { listArticles, parseFilters } from "@/lib/queries";
import { DESIGN_LABELS } from "@/lib/evidence/taxonomy";
import { checkApiAuth } from "@/lib/security";
import { csvRow } from "@/lib/export";
import { citeBibtex } from "@/lib/citation";
import { i18nOf } from "@/lib/i18n/request";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { t } = i18nOf(req);
  const auth = checkApiAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });
  }

  const sp = req.nextUrl.searchParams;
  const format = sp.get("format") ?? "csv";
  const f = parseFilters(sp);
  f.page = 1;
  f.pageSize = 2000;
  const { items } = await listArticles(f);
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "json") {
    return new NextResponse(JSON.stringify(items, null, 2), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="ent-radar-${stamp}.json"` },
    });
  }
  if (format === "bibtex" || format === "bib") {
    const body = items.map((a) => citeBibtex(a)).join("\n\n") + "\n";
    return new NextResponse(body, {
      headers: { "Content-Type": "application/x-bibtex; charset=utf-8", "Content-Disposition": `attachment; filename="ent-radar-${stamp}.bib"` },
    });
  }
  if (format === "ris") {
    const typeMap: Record<string, string> = { systematic_review: "JOUR", guideline: "JOUR", rct: "JOUR", trial_registry: "DATA", preprint: "UNPB" };
    const body = items
      .map((a) => {
        const lines = [`TY  - ${typeMap[a.studyDesign] ?? "JOUR"}`, `TI  - ${a.title}`];
        for (const au of a.authors) lines.push(`AU  - ${au}`);
        if (a.journal) lines.push(`JO  - ${a.journal}`);
        if (a.publishedAt) lines.push(`PY  - ${new Date(a.publishedAt).getFullYear()}`, `DA  - ${new Date(a.publishedAt).toISOString().slice(0, 10).replace(/-/g, "/")}`);
        if (a.doi) lines.push(`DO  - ${a.doi}`);
        if (a.pmid) lines.push(`AN  - ${a.pmid}`);
        if (a.abstract) lines.push(`AB  - ${a.abstract.replace(/\s+/g, " ")}`);
        lines.push(`UR  - ${a.url}`);
        for (const k of a.keywords.slice(0, 15)) lines.push(`KW  - ${k}`);
        lines.push(`N1  - ${t("Дизайн: {design}; уровень доказательности {level}; индекс доверия {trust}/100", { design: t(DESIGN_LABELS[a.studyDesign]), level: a.evidenceLevel, trust: a.trustScore })}`);
        lines.push("ER  - ");
        return lines.join("\r\n");
      })
      .join("\r\n");
    return new NextResponse(body, {
      headers: { "Content-Type": "application/x-research-info-systems; charset=utf-8", "Content-Disposition": `attachment; filename="ent-radar-${stamp}.ris"` },
    });
  }
  const header = ["id", "title", "journal", "published", "design", "evidence_level", "trust_score", "subspecialties", "pmid", "doi", "nct", "sources", "url", "authors"];
  const rows = items.map((a) =>
    csvRow([
      a.id, a.title, a.journal, a.publishedAt ? new Date(a.publishedAt).toISOString().slice(0, 10) : "", DESIGN_LABELS[a.studyDesign], a.evidenceLevel,
      a.trustScore, a.subspecialties.join("; "), a.pmid ?? "", a.doi ?? "", a.nctId ?? "", a.sourceKeys.join("; "), a.url, a.authors.join("; "),
    ]),
  );
  const csv = "\uFEFF" + [header.join(","), ...rows].join("\r\n");
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="ent-radar-${stamp}.csv"` },
  });
}
