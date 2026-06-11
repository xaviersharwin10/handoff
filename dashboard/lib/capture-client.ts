/**
 * Client helper to mint this account's capture token. Signs an account-bound
 * message with the browser device key; the server verifies it against the
 * on-chain delegate list before minting (same auth as memory ops).
 */
import { signWithDeviceKey } from "./device-key";

export async function getCaptureToken(address: string, accountId: string): Promise<string> {
  const ts = Date.now();
  const sig = await signWithDeviceKey(address, `handoff-mem|${accountId}|capture-token|${ts}`);
  const r = await fetch("/api/capture-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId, ts, sig }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || "could not mint capture token");
  return data.token as string;
}
