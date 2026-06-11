import { NextResponse } from "next/server";
import { enoki, assertAllowedTargets } from "@/lib/enoki-server";
import { NETWORK } from "@/lib/config";
import { readJson, str, suiId, strArray } from "@/lib/validate";
import { fail, tooMany } from "@/lib/http";
import { rateLimit, clientKey, sweep } from "@/lib/ratelimit";

export const runtime = "nodejs";

/**
 * Create an Enoki-sponsored transaction from client-built transaction-kind bytes.
 * The sponsor only pays for our allowlisted Move calls, and only for the given
 * sender. Returns the full sponsored bytes (for the user to sign) + digest.
 */
export async function POST(req: Request) {
  try {
    sweep();
    const rl = rateLimit(`sponsor:${clientKey(req)}`, 20, 60_000);
    if (!rl.ok) return tooMany(rl.retryAfter);

    const body = await readJson(req);
    const transactionKindBytes = str(body.transactionKindBytes, "transactionKindBytes", 200_000);
    const sender = suiId(body.sender, "sender");
    const allowedMoveCallTargets = strArray(body.allowedMoveCallTargets, "allowedMoveCallTargets", 8, 300);
    assertAllowedTargets(allowedMoveCallTargets);

    const { bytes, digest } = await enoki.createSponsoredTransaction({
      network: NETWORK,
      transactionKindBytes,
      sender,
      allowedAddresses: [sender],
      allowedMoveCallTargets,
    });
    return NextResponse.json({ bytes, digest });
  } catch (e) {
    return fail(e);
  }
}
