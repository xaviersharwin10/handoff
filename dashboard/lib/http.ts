import { NextResponse } from "next/server";
import { ValidationError } from "./validate";

/** Map an error to a JSON response with a sensible status. */
const NETWORK_HINT = /timeout|fetch failed|ECONNREFUSED|ENOTFOUND|UND_ERR|socket hang up/i;

export function fail(e: unknown, fallbackStatus = 500) {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof ValidationError) return NextResponse.json({ error: msg }, { status: 400 });
  if (msg.startsWith("unauthorized") || msg.includes("timestamp") || msg.includes("signature")) {
    return NextResponse.json({ error: msg }, { status: 401 });
  }
  if (NETWORK_HINT.test(msg)) {
    return NextResponse.json({ error: "The memory service is busy right now — please try again in a moment." }, { status: 503 });
  }
  return NextResponse.json({ error: msg }, { status: fallbackStatus });
}

export function tooMany(retryAfter: number) {
  return NextResponse.json(
    { error: "rate limited — slow down" },
    { status: 429, headers: { "retry-after": String(retryAfter) } },
  );
}
