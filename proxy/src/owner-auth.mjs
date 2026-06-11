/**
 * Owner-operation auth at the gateway, fully on-chain + stateless: the browser
 * signs a fresh, account-bound message with its device key; we verify the
 * signature against the account's registered delegate public keys read from
 * chain. Mirrors the dashboard's lib/memory-server.ts message format:
 *     handoff-mem|<accountId>|<op>|<ts>
 */
import * as ed from "@noble/ed25519";
import { config } from "./config.mjs";

const FRESHNESS_MS = 2 * 60_000;

async function rpc(method, params) {
  const r = await fetch(config.suiRpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await r.json()).result;
}

async function registeredDelegatePubkeys(accountId) {
  const obj = await rpc("sui_getObject", [accountId, { showContent: true }]);
  const keys = obj?.data?.content?.fields?.delegate_keys || [];
  return keys.map((k) => Uint8Array.from(k.fields.public_key));
}

/** Throws unless sigHex is a fresh device-key signature from a registered delegate. */
export async function assertOwnerAuth(accountId, op, ts, sigHex) {
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > FRESHNESS_MS) {
    throw new Error("stale_timestamp");
  }
  const msg = new TextEncoder().encode(`handoff-mem|${accountId}|${op}|${ts}`);
  const sig = Uint8Array.from(Buffer.from(sigHex, "hex"));
  for (const pk of await registeredDelegatePubkeys(accountId)) {
    try {
      if (await ed.verifyAsync(sig, msg, pk)) return;
    } catch {
      /* try next */
    }
  }
  throw new Error("unauthorized");
}
