/**
 * Client grant ops. The grant credential keypair is generated in the browser
 * and shown to the user once — the server never sees the private key. The grant
 * itself is a user-signed, gas-sponsored Move call (sender = grantor).
 */
import * as ed from "@noble/ed25519";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { buildCreateGrantTx, buildRevokeGrantTx, grantIdFromTxResult } from "./chain";
import { sponsorSignExecute } from "./sponsor-client";

type SignFn = (args: { transaction: string; chain: `sui:${string}` }) => Promise<{ bytes: string; signature: string }>;

type Common = { suiClient: SuiJsonRpcClient; signTransaction: SignFn; address: string };

function toHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function createGrant(
  opts: Common & { accountId: string; namespace: string; granteeLabel: string; ttlMs: number },
): Promise<{ grantId: string | null; credentialPrivateKey: string; granteeLabel: string; namespace: string }> {
  const credPriv = ed.utils.randomPrivateKey();
  const credPub = await ed.getPublicKeyAsync(credPriv);

  const { tx, targets } = buildCreateGrantTx({
    memwalAccount: opts.accountId,
    namespace: opts.namespace,
    granteeLabel: opts.granteeLabel,
    granteePubkey: credPub,
    ttlMs: opts.ttlMs,
  });
  const res = await sponsorSignExecute({
    tx,
    suiClient: opts.suiClient,
    signTransaction: opts.signTransaction,
    sender: opts.address,
    targets,
  });

  return {
    grantId: grantIdFromTxResult(res),
    credentialPrivateKey: toHex(credPriv),
    granteeLabel: opts.granteeLabel,
    namespace: opts.namespace,
  };
}

export async function revokeGrant(opts: Common & { grantId: string }): Promise<void> {
  const { tx, targets } = buildRevokeGrantTx(opts.grantId);
  await sponsorSignExecute({
    tx,
    suiClient: opts.suiClient,
    signTransaction: opts.signTransaction,
    sender: opts.address,
    targets,
  });
}
