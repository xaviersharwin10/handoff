/**
 * Client vault ops — user-signed, gas-sponsored Move calls against the Handoff
 * Vault (the on-chain Seal policy). Shredding here IS the deletion: once the tx
 * lands, the Seal key servers refuse decryption shares for that memory forever.
 */
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { buildShredOneTx, buildShredAllTx } from "./chain";
import { sponsorSignExecute } from "./sponsor-client";

type SignFn = (args: { transaction: string; chain: `sui:${string}` }) => Promise<{ bytes: string; signature: string }>;
type Common = { suiClient: SuiJsonRpcClient; signTransaction: SignFn; address: string };

/** Provably delete one memory. Returns the proof tx digest. */
export async function shredMemory(opts: Common & { vaultId: string; memId: string }): Promise<string> {
  const { tx, targets } = buildShredOneTx(opts.vaultId, opts.memId);
  const res = await sponsorSignExecute({
    tx,
    suiClient: opts.suiClient,
    signTransaction: opts.signTransaction,
    sender: opts.address,
    targets,
  });
  return res.digest;
}

/** Provably delete EVERYTHING in the vault. Irreversible. Returns the proof tx digest. */
export async function shredEverything(opts: Common & { vaultId: string }): Promise<string> {
  const { tx, targets } = buildShredAllTx(opts.vaultId);
  const res = await sponsorSignExecute({
    tx,
    suiClient: opts.suiClient,
    signTransaction: opts.signTransaction,
    sender: opts.address,
    targets,
  });
  return res.digest;
}
