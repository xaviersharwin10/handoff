import { NextResponse } from "next/server";
import { createGrant, listGrants } from "@/lib/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ grants: await listGrants() });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e), grants: [] }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { namespace, granteeLabel, ttlMs } = await req.json();
  if (!namespace || !granteeLabel) return NextResponse.json({ error: "namespace and granteeLabel required" }, { status: 400 });
  try {
    const grant = await createGrant(String(namespace), String(granteeLabel), Number(ttlMs) || 3_600_000);
    return NextResponse.json(grant);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
