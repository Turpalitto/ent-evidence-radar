import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { ensureSeeded } from "@/lib/refresh";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  return NextResponse.json(await db.select().from(sources).orderBy(asc(sources.id)));
}
