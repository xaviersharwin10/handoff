import { NextResponse } from "next/server";
import { enoki } from "@/lib/enoki-server";
import { readJson, str } from "@/lib/validate";
import { fail, tooMany } from "@/lib/http";
import { rateLimit, clientKey, sweep } from "@/lib/ratelimit";

export const runtime = "nodejs";

/** Submit the user's signature for a sponsored transaction and execute it. */
export async function POST(req: Request) {
  try {
    sweep();
    const rl = rateLimit(`exec:${clientKey(req)}`, 20, 60_000);
    if (!rl.ok) return tooMany(rl.retryAfter);

    const body = await readJson(req);
    const digest = str(body.digest, "digest", 200);
    const signature = str(body.signature, "signature", 4000);

    const result = await enoki.executeSponsoredTransaction({ digest, signature });
    return NextResponse.json({ digest: result.digest });
  } catch (e) {
    return fail(e);
  }
}
