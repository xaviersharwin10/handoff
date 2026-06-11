/**
 * Client-side helper: build a transaction's kind bytes, have the server sponsor
 * gas (Enoki), have the user sign via their zkLogin wallet, then execute.
 *
 * The flow is the de-risked one: the wallet re-serializes the sponsored bytes
 * before signing, which is byte-identical, so the sponsored digest stays valid.
 */
import { Transaction } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { SuiTransactionBlockResponse } from "@mysten/sui/jsonRpc";
import { NETWORK } from "./config";

type SignFn = (args: {
  transaction: string;
  chain: `sui:${string}`;
}) => Promise<{ bytes: string; signature: string }>;

async function postJson(url: string, body: unknown) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || `${url} failed`);
  return data;
}

export async function sponsorSignExecute(opts: {
  tx: Transaction;
  suiClient: SuiJsonRpcClient;
  signTransaction: SignFn;
  sender: string;
  targets: string[];
}): Promise<SuiTransactionBlockResponse> {
  const { tx, suiClient, signTransaction, sender, targets } = opts;

  const kindBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });

  const sponsored = await postJson("/api/sponsor", {
    transactionKindBytes: toBase64(kindBytes),
    sender,
    allowedMoveCallTargets: targets,
  });

  const { signature } = await signTransaction({
    transaction: sponsored.bytes,
    chain: `sui:${NETWORK}`,
  });

  const exec = await postJson("/api/sponsor/execute", {
    digest: sponsored.digest,
    signature,
  });

  return suiClient.waitForTransaction({
    digest: exec.digest,
    options: { showObjectChanges: true, showEffects: true },
  });
}
