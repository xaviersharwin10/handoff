/**
 * On-chain grant reading + credential verification.
 */
import * as ed from "@noble/ed25519";

/** Canonical message a grantee signs to prove it holds the grant credential. */
export function recallMessage(grantId, query, timestamp) {
  return new TextEncoder().encode(`handoff.recall|${grantId}|${query}|${timestamp}`);
}

function toBytes(v) {
  // A Move vector<u8> field can come back as a number[] (JSON-RPC) or base64 (CLI).
  if (Array.isArray(v)) return Uint8Array.from(v);
  if (typeof v === "string") return Uint8Array.from(Buffer.from(v, "base64"));
  throw new Error("unexpected vector<u8> encoding");
}

/**
 * Fetch a Grant object and return its normalized fields, or null if it does
 * not exist / is not a Handoff Grant of the expected package.
 */
export async function fetchGrant(rpcUrl, packageId, grantId) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sui_getObject",
      params: [grantId, { showContent: true, showType: true }],
    }),
  });
  const j = await res.json();
  const data = j.result?.data;
  const content = data?.content;
  if (!content || content.dataType !== "moveObject") return null;
  if (!content.type?.startsWith(`${packageId}::grants::Grant`)) return null;

  const f = content.fields;
  return {
    grantId,
    grantor: f.grantor,
    memwalAccount: f.memwal_account,
    namespace: f.namespace,
    granteeLabel: f.grantee_label,
    granteePubkey: toBytes(f.grantee_pubkey),
    createdAt: BigInt(f.created_at),
    expiresAt: BigInt(f.expires_at),
    revoked: Boolean(f.revoked),
  };
}

/**
 * Validate a grant for use right now. Returns { ok } or { ok:false, reason }.
 * Pure on-chain truth: not revoked, not expired.
 */
export function checkGrantValidity(grant, nowMs = Date.now()) {
  if (!grant) return { ok: false, reason: "grant_not_found" };
  if (grant.revoked) return { ok: false, reason: "grant_revoked" };
  if (BigInt(nowMs) >= grant.expiresAt) return { ok: false, reason: "grant_expired" };
  return { ok: true };
}

/** Verify the grantee signed the canonical recall message with the credential key. */
export async function verifyCredential(grant, query, timestamp, signature) {
  const msg = recallMessage(grant.grantId, query, timestamp);
  const sig = typeof signature === "string" ? Uint8Array.from(Buffer.from(signature, "hex")) : signature;
  try {
    return await ed.verifyAsync(sig, msg, grant.granteePubkey);
  } catch {
    return false;
  }
}
