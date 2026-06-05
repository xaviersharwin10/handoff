import { NextResponse } from "next/server";
import { accessLog } from "@/lib/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await accessLog());
}
