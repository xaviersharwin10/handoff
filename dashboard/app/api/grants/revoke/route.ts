import { NextResponse } from "next/server";
import { revokeGrant } from "@/lib/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { grantId } = await req.json();
  if (!grantId) return NextResponse.json({ error: "grantId required" }, { status: 400 });
  try {
    revokeGrant(String(grantId));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
