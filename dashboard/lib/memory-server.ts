/**
 * Server-only device-key authorization (used by the capture-token route).
 *
 * Fully on-chain + stateless: the browser signs a fresh, account-bound message
 * with its device key; we verify that signature against the account's
 * registered delegate public keys (read from chain). Only a holder of a
 * registered delegate key can drive operations for that account.
 *
 * Memory itself now lives in the gateway's self-Seal layer (Seal + Walrus +
 * own index) — the dashboard talks to the gateway directly for memory ops.
 */
import "server-only";
import * as ed from "@noble/ed25519";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";

const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" });
const FRESHNESS_MS = 2 * 60_000;

export function memAuthMessage(accountId: string, op: string, ts: number): string {
  return `handoff-mem|${accountId}|${op}|${ts}`;
}

async function registeredDelegatePubkeys(accountId: string): Promise<Uint8Array[]> {
  const obj = await client.getObject({ id: accountId, options: { showContent: true } });
  const keys = (obj.data?.content as any)?.fields?.delegate_keys || [];
  return keys.map((k: any) => Uint8Array.from(k.fields.public_key as number[]));
}

/** Throws unless `sigHex` is a fresh device-key signature from a registered delegate. */
export async function assertDelegateAuth(accountId: string, op: string, ts: number, sigHex: string) {
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > FRESHNESS_MS) {
    throw new Error("stale or invalid timestamp");
  }
  const msg = new TextEncoder().encode(memAuthMessage(accountId, op, ts));
  const sig = Uint8Array.from(Buffer.from(sigHex, "hex"));
  const pubkeys = await registeredDelegatePubkeys(accountId);
  for (const pk of pubkeys) {
    try {
      if (await ed.verifyAsync(sig, msg, pk)) return;
    } catch {
      /* try next */
    }
  }
  throw new Error("unauthorized: signature does not match any registered delegate");
}
