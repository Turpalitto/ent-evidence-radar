import { NextRequest, NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { topics } from "@/db/schema";
import { ensureSeeded } from "@/lib/refresh";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  const rows = await db.select().from(topics).orderBy(asc(topics.id));
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { name?: string; query?: string; subspecialty?: string; lookbackDays?: number | null };
  if (!body.name?.trim() || !body.query?.trim()) return NextResponse.json({ error: "name и query обязательны" }, { status: 400 });
  const [row] = await db
    .insert(topics)
    .values({ name: body.name.trim(), query: body.query.trim(), subspecialty: body.subspecialty ?? "general", lookbackDays: typeof body.lookbackDays === "number" && body.lookbackDays > 0 ? Math.min(730, Math.round(body.lookbackDays)) : null })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
