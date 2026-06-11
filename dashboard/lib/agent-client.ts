/**
 * Third-party agent client. An agent holds ONLY a grant credential (grantId +
 * Ed25519 private key). It reads the grant's public terms from chain and pulls
 * scoped memory just-in-time through the Handoff gateway — it has no standing
 * access and no copy of your memory.
 */
import * as ed from "@noble/ed25519";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { HANDOFF, GATEWAY_URL } from "./config";

const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" });

export type GrantTerms = {
  grantId: string;
  granteeLabel: string;
  namespace: string;
  memwalAccount: string;
  grantor: string;
  expiresAt: number;
  revoked: boolean;
  status: "active" | "expired" | "revoked";
};

export type Credential = { grantId: string; credentialPrivateKey: string };

/** Read a grant's public terms straight from Sui (what the agent is allowed). */
export async function readGrantTerms(grantId: string): Promise<GrantTerms | null> {
  const obj = await client.getObject({ id: grantId, options: { showContent: true, showType: true } });
  const type = (obj.data as any)?.type as string | undefined;
  if (!type || !type.includes(`${HANDOFF.packageId}::grants::Grant`)) return null;
  const f = (obj.data?.content as any)?.fields;
  if (!f) return null;
  const expiresAt = Number(f.expires_at);
  const revoked = Boolean(f.revoked);
  const status = revoked ? "revoked" : Date.now() >= expiresAt ? "expired" : "active";
  return {
    grantId,
    granteeLabel: f.grantee_label,
    namespace: f.namespace,
    memwalAccount: f.memwal_account,
    grantor: f.grantor,
    expiresAt,
    revoked,
    status,
  };
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function toHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export type RecalledMemory = { text: string; distance: number; src?: string; at?: number };

export type RecallOutcome =
  | { allowed: true; namespace: string; granteeLabel: string; results: RecalledMemory[] }
  | { allowed: false; reason: string };

export type RememberOutcome =
  | { allowed: true; namespace: string; granteeLabel: string; memId: string }
  | { allowed: false; reason: string };

/** Sign a grant operation with the credential. Each op ("recall" | "remember")
 *  has its own canonical message, so one signature can't authorize the other. */
async function signGrantOp(credential: Credential, op: string, payload: string, timestamp: number) {
  const msg = new TextEncoder().encode(`handoff.${op}|${credential.grantId}|${payload}|${timestamp}`);
  return toHex(await ed.signAsync(msg, fromHex(credential.credentialPrivateKey)));
}

/** Sign a recall with the credential and ask the gateway. The gateway enforces
 *  scope/expiry/revocation from chain — the agent cannot widen any of it. */
export async function agentRecall(
  credential: Credential,
  query: string,
): Promise<RecallOutcome> {
  const timestamp = Date.now();
  const signature = await signGrantOp(credential, "recall", query, timestamp);

  const r = await fetch(`${GATEWAY_URL}/recall`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grantId: credential.grantId, query, timestamp, signature }),
  });
  const data = await r.json();
  if (!r.ok || data.allowed === false) {
    return { allowed: false, reason: data?.reason || `gateway error ${r.status}` };
  }
  return { allowed: true, namespace: data.namespace, granteeLabel: data.granteeLabel, results: data.results || [] };
}

/** Write a memory back into the ONE granted namespace (agents learn over time).
 *  Same on-chain enforcement as recall; the write is provenance-tagged with the
 *  agent's label and the owner can shred it — with proof — at any time. */
export async function agentRemember(
  credential: Credential,
  text: string,
): Promise<RememberOutcome> {
  const timestamp = Date.now();
  const signature = await signGrantOp(credential, "remember", text, timestamp);

  const r = await fetch(`${GATEWAY_URL}/remember`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grantId: credential.grantId, text, timestamp, signature }),
  });
  const data = await r.json();
  if (!r.ok || data.allowed === false) {
    return { allowed: false, reason: data?.reason || `gateway error ${r.status}` };
  }
  return { allowed: true, namespace: data.namespace, granteeLabel: data.granteeLabel, memId: data.memId };
}
