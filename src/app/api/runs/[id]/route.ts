import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { fetchRuns } from "@/db/schema";
import { parseId } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Состояние одного запуска: статус, прогресс по источникам, итоги. Опрашивается UI/cron после `POST /api/refresh`. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ ok: false, error: "Некорректный id запуска" }, { status: 400 });
  const [run] = await db.select().from(fetchRuns).where(eq(fetchRuns.id, id)).limit(1);
  if (!run) return NextResponse.json({ ok: false, error: "Запуск не найден" }, { status: 404 });
  return NextResponse.json({ ok: true, run, finished: run.status !== "running" }, { headers: { "Cache-Control": "no-store" } });
}
