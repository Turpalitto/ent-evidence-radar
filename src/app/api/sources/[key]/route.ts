import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { checkApiAuth } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const auth = checkApiAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });
  }

  const { key } = await ctx.params;
  const body = (await req.json()) as { enabled?: boolean };
  const rows = await db.update(sources).set({ enabled: !!body.enabled }).where(eq(sources.key, key)).returning();
  if (!rows.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(rows[0]);
}
