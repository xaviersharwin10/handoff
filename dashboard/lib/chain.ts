/**
 * On-chain reads + transaction builders for Handoff, run on the client against
 * the dapp-kit SuiClient. Everything is derived from chain — no database.
 */
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { MEMWAL, HANDOFF, VAULT, PROXY_DELEGATE, CLOCK_ID, TARGETS } from "./config";

export type AccessEntry = {
  at: string;
  allowed: boolean;
  reason?: string;
  granteeLabel?: string;
  namespace?: string;
  resultCount?: number;
  grantId?: string;
};

/**
 * The audit log, read from chain (AccessLogged events). Only entries emitted by
 * the known gateway address are trusted, so forged entries are ignored. Note:
 * the user's query text is deliberately NOT on-chain (privacy) — only the
 * decision, slice, and count.
 */
export async function listAccessLog(
  client: SuiJsonRpcClient,
  accountId: string,
): Promise<AccessEntry[]> {
  const events = await client.queryEvents({
    query: { MoveEventType: `${HANDOFF.packageId}::grants::AccessLogged` },
    limit: 50,
    order: "descending",
  });
  return (events.data || [])
    .map((e: any) => e.parsedJson)
    .filter((j: any) => j && j.memwal_account === accountId && j.gateway === PROXY_DELEGATE.address)
    .map((j: any) => ({
      at: new Date(Number(j.at)).toISOString(),
      allowed: Boolean(j.allowed),
      reason: j.reason || undefined,
      granteeLabel: j.grantee_label || undefined,
      namespace: j.namespace || undefined,
      resultCount: Number(j.result_count) || 0,
      grantId: j.grant_id,
    }));
}

export type GrantView = {
  grantId: string;
  namespace: string;
  granteeLabel: string;
  grantor: string;
  memwalAccount: string;
  expiresAt: number;
  revoked: boolean;
  status: "active" | "expired" | "revoked";
};

export type AccountInfo = {
  accountId: string;
  owner: string;
  active: boolean;
  delegateAddresses: string[];
};

// ---------------------------------------------------------------- reads

/** The MemWalAccount object id owned by `owner`, or null if not provisioned. */
export async function getAccountIdForOwner(
  client: SuiJsonRpcClient,
  owner: string,
): Promise<string | null> {
  const reg = await client.getObject({ id: MEMWAL.registryId, options: { showContent: true } });
  const content = reg.data?.content as any;
  const tableId = content?.fields?.accounts?.fields?.id?.id;
  if (!tableId) return null;
  try {
    const df = await client.getDynamicFieldObject({
      parentId: tableId,
      name: { type: "address", value: owner },
    });
    const value = (df.data?.content as any)?.fields?.value;
    return value ?? null;
  } catch {
    return null; // dynamic field not found => no account
  }
}

/** Read a MemWalAccount's owner / active flag / delegate addresses. */
export async function getAccountInfo(
  client: SuiJsonRpcClient,
  accountId: string,
): Promise<AccountInfo | null> {
  const obj = await client.getObject({ id: accountId, options: { showContent: true } });
  const fields = (obj.data?.content as any)?.fields;
  if (!fields) return null;
  const delegateAddresses: string[] = (fields.delegate_keys || []).map(
    (k: any) => k.fields?.sui_address,
  );
  return {
    accountId,
    owner: fields.owner,
    active: Boolean(fields.active),
    delegateAddresses,
  };
}

/** All grants this owner has ever issued, with current on-chain status. */
export async function listGrantsForOwner(
  client: SuiJsonRpcClient,
  owner: string,
): Promise<GrantView[]> {
  const events = await client.queryEvents({
    query: { MoveEventType: `${HANDOFF.packageId}::${HANDOFF.module}::GrantCreated` },
    limit: 50,
    order: "descending",
  });
  const ids: string[] = (events.data || [])
    .filter((e: any) => e.parsedJson?.grantor === owner)
    .map((e: any) => e.parsedJson.grant_id);
  if (ids.length === 0) return [];

  const objs = await client.multiGetObjects({ ids, options: { showContent: true } });
  const now = Date.now();
  return objs
    .map((o: any) => o?.data?.content?.fields)
    .filter(Boolean)
    .map((f: any) => {
      const expiresAt = Number(f.expires_at);
      const revoked = Boolean(f.revoked);
      const status: GrantView["status"] = revoked
        ? "revoked"
        : now >= expiresAt
          ? "expired"
          : "active";
      return {
        grantId: f.id?.id ?? f.id,
        namespace: f.namespace,
        granteeLabel: f.grantee_label,
        grantor: f.grantor,
        memwalAccount: f.memwal_account,
        expiresAt,
        revoked,
        status,
      };
    });
}

// ---------------------------------------------------------------- vault (Seal policy)

export type VaultInfo = {
  vaultId: string;
  owner: string;
  wipedAll: boolean;
  delegates: string[];
};

/** The Vault object id owned by `owner` (from the on-chain registry), or null. */
export async function getVaultForOwner(
  client: SuiJsonRpcClient,
  owner: string,
): Promise<string | null> {
  const reg = await client.getObject({ id: VAULT.registryId, options: { showContent: true } });
  const tableId = (reg.data?.content as any)?.fields?.vaults?.fields?.id?.id;
  if (!tableId) return null;
  try {
    const df = await client.getDynamicFieldObject({
      parentId: tableId,
      name: { type: "address", value: owner },
    });
    return ((df.data?.content as any)?.fields?.value as string) ?? null;
  } catch {
    return null;
  }
}

/** Read a Vault's owner / wiped flag / delegate addresses. */
export async function getVaultInfo(
  client: SuiJsonRpcClient,
  vaultId: string,
): Promise<VaultInfo | null> {
  const obj = await client.getObject({ id: vaultId, options: { showContent: true } });
  const f = (obj.data?.content as any)?.fields;
  if (!f) return null;
  return {
    vaultId,
    owner: f.owner,
    wipedAll: Boolean(f.wiped_all),
    delegates: f.delegates || [],
  };
}

export function buildCreateVaultTx(): { tx: Transaction; targets: string[] } {
  const tx = new Transaction();
  tx.moveCall({ target: TARGETS.createVault, arguments: [tx.object(VAULT.registryId)] });
  return { tx, targets: [TARGETS.createVault] };
}

export function buildAddVaultDelegateTx(vaultId: string, who: string): { tx: Transaction; targets: string[] } {
  const tx = new Transaction();
  tx.moveCall({
    target: TARGETS.addVaultDelegate,
    arguments: [tx.object(vaultId), tx.pure.address(who)],
  });
  return { tx, targets: [TARGETS.addVaultDelegate] };
}

/** Provably delete ONE memory (memIdHex = 32 hex chars). */
export function buildShredOneTx(vaultId: string, memIdHex: string): { tx: Transaction; targets: string[] } {
  const tx = new Transaction();
  tx.moveCall({
    target: TARGETS.shredOne,
    arguments: [tx.object(vaultId), tx.pure(bcs.vector(bcs.u8()).serialize(Array.from(hexToBytes(memIdHex))))],
  });
  return { tx, targets: [TARGETS.shredOne] };
}

/** Provably delete EVERYTHING (panic button). Irreversible. */
export function buildShredAllTx(vaultId: string): { tx: Transaction; targets: string[] } {
  const tx = new Transaction();
  tx.moveCall({ target: TARGETS.shredAll, arguments: [tx.object(vaultId)] });
  return { tx, targets: [TARGETS.shredAll] };
}

export type ShredProof = {
  at: string;
  kind: "memory" | "everything";
  memId?: string;
  txDigest: string;
};

/** On-chain deletion proofs for a vault (Shredded + WipedAll events). */
export async function listShredProofs(
  client: SuiJsonRpcClient,
  vaultId: string,
): Promise<ShredProof[]> {
  const out: ShredProof[] = [];
  for (const [type, kind] of [
    [`${VAULT.packageId}::vault::Shredded`, "memory"],
    [`${VAULT.packageId}::vault::WipedAll`, "everything"],
  ] as const) {
    try {
      const events = await client.queryEvents({
        query: { MoveEventType: type },
        limit: 30,
        order: "descending",
      });
      for (const e of (events.data || []) as any[]) {
        const j = e.parsedJson;
        if (!j || j.vault !== vaultId) continue;
        out.push({
          at: new Date(Number(e.timestampMs)).toISOString(),
          kind,
          memId: Array.isArray(j.memory_id)
            ? Array.from(j.memory_id as number[]).map((b) => b.toString(16).padStart(2, "0")).join("")
            : undefined,
          txDigest: e.id?.txDigest,
        });
      }
    } catch {
      /* transient */
    }
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

// ---------------------------------------------------------------- tx builders

export function buildCreateAccountTx(): { tx: Transaction; targets: string[] } {
  const tx = new Transaction();
  tx.moveCall({
    target: TARGETS.createAccount,
    arguments: [tx.object(MEMWAL.registryId), tx.object(CLOCK_ID)],
  });
  return { tx, targets: [TARGETS.createAccount] };
}

export type DelegateSpec = { pubBytes: Uint8Array; address: string; label: string };

/** Add one or more delegate keys to an account in a single PTB (same shared object). */
export function buildAddDelegatesTx(
  accountId: string,
  delegates: DelegateSpec[],
): { tx: Transaction; targets: string[] } {
  const tx = new Transaction();
  for (const d of delegates) {
    tx.moveCall({
      target: TARGETS.addDelegateKey,
      arguments: [
        tx.object(accountId),
        tx.pure(bcs.vector(bcs.u8()).serialize(Array.from(d.pubBytes))),
        tx.pure.address(d.address),
        tx.pure.string(d.label),
        tx.object(CLOCK_ID),
      ],
    });
  }
  return { tx, targets: [TARGETS.addDelegateKey] };
}

export function buildCreateGrantTx(opts: {
  memwalAccount: string;
  namespace: string;
  granteeLabel: string;
  granteePubkey: Uint8Array;
  ttlMs: number;
}): { tx: Transaction; targets: string[] } {
  const tx = new Transaction();
  tx.moveCall({
    target: TARGETS.createGrant,
    arguments: [
      tx.pure.address(opts.memwalAccount),
      tx.pure.string(opts.namespace),
      tx.pure.string(opts.granteeLabel),
      tx.pure(bcs.vector(bcs.u8()).serialize(Array.from(opts.granteePubkey))),
      tx.pure.u64(opts.ttlMs),
      tx.object(CLOCK_ID),
    ],
  });
  return { tx, targets: [TARGETS.createGrant] };
}

export function buildRevokeGrantTx(grantId: string): { tx: Transaction; targets: string[] } {
  const tx = new Transaction();
  tx.moveCall({
    target: TARGETS.revokeGrant,
    arguments: [tx.object(grantId), tx.object(CLOCK_ID)],
  });
  return { tx, targets: [TARGETS.revokeGrant] };
}

// ---------------------------------------------------------------- util

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Find the newly-created MemWalAccount id from a create_account tx result. */
export function accountIdFromTxResult(result: any): string | null {
  const created = (result?.objectChanges || []).find(
    (o: any) => o.type === "created" && o.objectType?.includes("::account::MemWalAccount"),
  );
  return created?.objectId ?? null;
}

/** Find the newly-created Grant id from a create_grant tx result. */
export function grantIdFromTxResult(result: any): string | null {
  const created = (result?.objectChanges || []).find(
    (o: any) => o.type === "created" && o.objectType?.includes("::grants::Grant"),
  );
  return created?.objectId ?? null;
}
