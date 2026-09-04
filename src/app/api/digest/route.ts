import { NextResponse } from "next/server";
import { buildDigestData, renderDigest } from "@/lib/digest";
import { getRecipients, sendMail } from "@/lib/mailer";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const g = globalThis as typeof globalThis & { __entRadarDigestRunning?: boolean };

async function currentData() {
  const data = await buildDigestData(7);
  return { ...renderDigest(data), data };
}

export async function GET() {
  const { html, text, data } = await currentData();
  return NextResponse.json({ ok: true, days: data.days, generatedAt: data.generatedAt, html, text, data });
}

export async function POST() {
  if (g.__entRadarDigestRunning) {
    return NextResponse.json({ ok: false, running: true, message: "Дайджест уже формируется" }, { status: 409 });
  }
  const recipients = getRecipients();
  if (!recipients.length) {
    return NextResponse.json({ ok: false, error: "Не заданы получатели (DIGEST_RECIPIENTS)" }, { status: 400 });
  }
  g.__entRadarDigestRunning = true;
  try {
    const { html, text, data } = await currentData();
    const res = await sendMail(recipients, `Дайджест ENT Evidence Radar за ${data.days} дн.`, html, text);
    return NextResponse.json({ ok: true, ...res, total: data.total });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    g.__entRadarDigestRunning = false;
  }
}
