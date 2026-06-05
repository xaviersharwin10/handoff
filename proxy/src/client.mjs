/**
 * Handoff recall client — used by third-party agents (and the demo agent).
 * Signs the canonical recall message with the grant credential and calls the proxy.
 */
import * as ed from "@noble/ed25519";
import { recallMessage } from "./grant.mjs";

export async function recallViaHandoff({ proxyUrl, grantId, credentialPrivateKey, query, limit }) {
  const timestamp = Date.now();
  const priv =
    typeof credentialPrivateKey === "string"
      ? Uint8Array.from(Buffer.from(credentialPrivateKey, "hex"))
      : credentialPrivateKey;
  const signature = await ed.signAsync(recallMessage(grantId, query, timestamp), priv);
  const res = await fetch(`${proxyUrl}/recall`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grantId,
      query,
      timestamp,
      signature: Buffer.from(signature).toString("hex"),
      limit,
    }),
  });
  return { status: res.status, body: await res.json() };
}
