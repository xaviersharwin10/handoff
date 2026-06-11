/**
 * @handoff/sdk — let any AI agent consume a Handoff grant.
 *
 * An agent holds only a grant credential (grantId + Ed25519 private key). With it
 * the agent can read the grant's public terms from chain and pull the ONE scoped
 * memory slice it was granted, just-in-time, through the Handoff gateway. It has
 * no standing access and no copy of the user's memory; the gateway enforces
 * scope, expiry and revocation from chain on every call.
 *
 * Dependency-light: Ed25519 signing only. Reads use plain JSON-RPC.
 */
import * as ed from "@noble/ed25519";

export type Credential = { grantId: string; credentialPrivateKey: string };

export type GrantStatus = "active" | "expired" | "revoked";

export type GrantTerms = {
  grantId: string;
  granteeLabel: string;
  namespace: string;
  memwalAccount: string;
  grantor: string;
  expiresAt: number;
  revoked: boolean;
  status: GrantStatus;
};

export type Memory = { text: string; distance: number; src?: string; at?: number };

export type RecallResult =
  | { allowed: true; namespace: string; granteeLabel: string; results: Memory[] }
  | { allowed: false; reason: string };

export type RememberResult =
  | { allowed: true; namespace: string; granteeLabel: string; memId: string }
  | { allowed: false; reason: string };

export type HandoffOptions = {
  /** The grant credential the user shared with this agent. */
  credential: Credential;
  /** Handoff gateway base URL. */
  gatewayUrl?: string;
  /** Sui JSON-RPC URL (for reading grant terms). */
  rpcUrl?: string;
  /** Handoff package id (to verify the object really is a Handoff grant). */
  packageId?: string;
};

export const DEFAULTS = {
  gatewayUrl: "http://localhost:8787",
  rpcUrl: "https://fullnode.testnet.sui.io:443",
  packageId: "0x524cf0a119a759b4b7375bd93cbdbcce480ff3e7791f20f0ec82aa8db05126cb",
};

function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function toHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export class HandoffClient {
  private credential: Credential;
  private gatewayUrl: string;
  private rpcUrl: string;
  private packageId: string;

  constructor(opts: HandoffOptions) {
    if (!opts?.credential?.grantId || !opts?.credential?.credentialPrivateKey) {
      throw new Error("HandoffClient: credential { grantId, credentialPrivateKey } is required");
    }
    this.credential = opts.credential;
    this.gatewayUrl = (opts.gatewayUrl || DEFAULTS.gatewayUrl).replace(/\/$/, "");
    this.rpcUrl = opts.rpcUrl || DEFAULTS.rpcUrl;
    this.packageId = opts.packageId || DEFAULTS.packageId;
  }

  /** Read the grant's public terms from chain (scope, expiry, status). */
  async terms(): Promise<GrantTerms | null> {
    const res = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sui_getObject",
        params: [this.credential.grantId, { showContent: true, showType: true }],
      }),
    });
    const data = (await res.json())?.result?.data;
    const type: string | undefined = data?.type;
    if (!type || !type.includes(`${this.packageId}::grants::Grant`)) return null;
    const f = data?.content?.fields;
    if (!f) return null;
    const expiresAt = Number(f.expires_at);
    const revoked = Boolean(f.revoked);
    const status: GrantStatus = revoked ? "revoked" : Date.now() >= expiresAt ? "expired" : "active";
    return {
      grantId: this.credential.grantId,
      granteeLabel: f.grantee_label,
      namespace: f.namespace,
      memwalAccount: f.memwal_account,
      grantor: f.grantor,
      expiresAt,
      revoked,
      status,
    };
  }

  /** Sign one grant operation. Ops are domain-separated ("recall" vs "remember")
   *  so a signature for one can never authorize the other. */
  private async sign(op: string, payload: string, timestamp: number): Promise<string> {
    const msg = new TextEncoder().encode(`handoff.${op}|${this.credential.grantId}|${payload}|${timestamp}`);
    return toHex(await ed.signAsync(msg, fromHex(this.credential.credentialPrivateKey)));
  }

  /**
   * Recall scoped memory through the gateway. Signs the request with the grant
   * credential; the gateway returns only the granted slice (or denies from chain).
   */
  async recall(query: string, opts: { limit?: number } = {}): Promise<RecallResult> {
    const timestamp = Date.now();
    const signature = await this.sign("recall", query, timestamp);

    const res = await fetch(`${this.gatewayUrl}/recall`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grantId: this.credential.grantId, query, timestamp, signature, limit: opts.limit }),
    });
    const data = await res.json();
    if (!res.ok || data?.allowed === false) {
      return { allowed: false, reason: data?.reason || `gateway error ${res.status}` };
    }
    return { allowed: true, namespace: data.namespace, granteeLabel: data.granteeLabel, results: data.results || [] };
  }

  /**
   * Write a memory back into the ONE namespace this grant covers — so the agent
   * can remember and build on its work over time. Enforced from chain exactly
   * like recall (expiry, revocation, scope); the write is provenance-tagged with
   * the agent's label, and the owner can shred it — with on-chain proof — anytime.
   */
  async remember(text: string): Promise<RememberResult> {
    const timestamp = Date.now();
    const signature = await this.sign("remember", text, timestamp);

    const res = await fetch(`${this.gatewayUrl}/remember`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grantId: this.credential.grantId, text, timestamp, signature }),
    });
    const data = await res.json();
    if (!res.ok || data?.allowed === false) {
      return { allowed: false, reason: data?.reason || `gateway error ${res.status}` };
    }
    return { allowed: true, namespace: data.namespace, granteeLabel: data.granteeLabel, memId: data.memId };
  }
}

/** Build a client from env vars: HANDOFF_GRANT_ID, HANDOFF_CREDENTIAL_KEY, HANDOFF_GATEWAY_URL, HANDOFF_RPC_URL. */
export function clientFromEnv(env: Record<string, string | undefined> = process.env): HandoffClient {
  const grantId = env.HANDOFF_GRANT_ID;
  const credentialPrivateKey = env.HANDOFF_CREDENTIAL_KEY;
  if (!grantId || !credentialPrivateKey) {
    throw new Error("Set HANDOFF_GRANT_ID and HANDOFF_CREDENTIAL_KEY");
  }
  return new HandoffClient({
    credential: { grantId, credentialPrivateKey },
    gatewayUrl: env.HANDOFF_GATEWAY_URL,
    rpcUrl: env.HANDOFF_RPC_URL,
    packageId: env.HANDOFF_PACKAGE_ID,
  });
}
