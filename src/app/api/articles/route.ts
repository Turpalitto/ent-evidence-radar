import { NextRequest, NextResponse } from "next/server";
import { listArticles, parseFilters } from "@/lib/queries";
import { ensureSeeded } from "@/lib/refresh";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await ensureSeeded();
  const f = parseFilters(req.nextUrl.searchParams);
  const data = await listArticles(f);
  return NextResponse.json(data);
}
