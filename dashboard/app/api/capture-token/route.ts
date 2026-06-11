import { NextResponse } from "next/server";
import { assertDelegateAuth } from "@/lib/memory-server";
import { mintCaptureToken } from "@/lib/capture-token";
import { readJson, suiId, hex, num } from "@/lib/validate";
import { fail, tooMany } from "@/lib/http";
import { rateLimit, clientKey, sweep } from "@/lib/ratelimit";

export const runtime = "nodejs";

/**
 * Mint a capture token for the caller's account (device-key authorized, no DB).
 * The token lets any OpenAI-compatible AI tool stream conversations into this
 * account's vault via the gateway's /capture/v1 endpoint.
 */
export async function POST(req: Request) {
  try {
    sweep();
    const rl = rateLimit(`captok:${clientKey(req)}`, 20, 60_000);
    if (!rl.ok) return tooMany(rl.retryAfter);

    const body = await readJson(req);
    const accountId = suiId(body.accountId, "accountId");
    const ts = num(body.ts, "ts");
    const sig = hex(body.sig, "sig");

    await assertDelegateAuth(accountId, "capture-token", ts, sig);
    return NextResponse.json({ token: mintCaptureToken(accountId) });
  } catch (e) {
    return fail(e);
  }
}
