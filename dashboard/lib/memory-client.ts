/**
 * Client memory ops — now served by the Handoff gateway's self-Seal memory
 * layer (embed → Seal-encrypt under YOUR vault → Walrus → own index). Auth is
 * unchanged: this browser's device key signs an account-bound message and the
 * gateway verifies it against the account's on-chain delegate list.
 */
import { signWithDeviceKey } from "./device-key";
import { GATEWAY_URL } from "./config";

function authMessage(accountId: string, op: string, ts: number): string {
  return `handoff-mem|${accountId}|${op}|${ts}`;
}

async function authedPost(path: string, address: string, accountId: string, op: string, body: object) {
  const ts = Date.now();
  const sig = await signWithDeviceKey(address, authMessage(accountId, op, ts));
  const r = await fetch(`${GATEWAY_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId, ts, sig, ...body }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || `${path} failed`);
  return data;
}

/** `src` = who wrote it: "you", "capture" (auto-captured from your AI tools), or an agent's grant label. */
export type MemoryRow = { memId: string; namespace: string; text: string; at: number; src?: string };

export async function rememberMemory(
  address: string,
  accountId: string,
  namespace: string,
  text: string,
): Promise<{ ok: boolean; memId: string }> {
  return authedPost("/memory", address, accountId, "remember", { namespace, text });
}

export async function recallMemory(
  address: string,
  accountId: string,
  namespace: string | undefined,
  query: string,
): Promise<{ results: { memId: string; namespace: string; text: string; score: number }[] }> {
  return authedPost("/memory/recall", address, accountId, "recall", { namespace, query });
}

export async function listMemories(
  address: string,
  accountId: string,
  opts: { namespace?: string; limit?: number } = {},
): Promise<{ memories: MemoryRow[]; namespaces: Record<string, number>; vaultId: string }> {
  return authedPost("/memory/list", address, accountId, "list", opts);
}

/** Tell the gateway a memory (or the whole vault) was shredded on-chain. */
export async function notifyShredded(
  address: string,
  accountId: string,
  opts: { memId?: string; all?: boolean },
): Promise<void> {
  await authedPost("/memory/shredded", address, accountId, "shredded", opts);
}
