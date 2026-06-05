import { NextResponse } from "next/server";
import { addMemory, listMemories } from "@/lib/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(listMemories());
}

export async function POST(req: Request) {
  const { namespace, text } = await req.json();
  if (!namespace || !text) return NextResponse.json({ error: "namespace and text required" }, { status: 400 });
  try {
    await addMemory(String(namespace).trim(), String(text).trim());
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
