import { NextRequest, NextResponse } from "next/server";
import { listArticles, parseFilters } from "@/lib/queries";
import { ensureSeeded } from "@/lib/refresh";
import { apiFailure } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await ensureSeeded();
    const f = parseFilters(req.nextUrl.searchParams);
    const data = await listArticles(f);
    return NextResponse.json(data);
  } catch (e) {
    return apiFailure(req, e, "GET /api/articles");
  }
}
