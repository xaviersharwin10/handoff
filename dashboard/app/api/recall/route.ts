import { NextResponse } from "next/server";
import { recallPreview } from "@/lib/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { namespace, query } = await req.json();
  if (!namespace || !query) return NextResponse.json({ error: "namespace and query required" }, { status: 400 });
  try {
    const results = await recallPreview(String(namespace), String(query));
    return NextResponse.json({ results });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
