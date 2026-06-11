/** Register the per-account DERIVED key as a delegate on a test account we OWN,
 *  so headless capture/recall (which use the derived key) are accepted. */
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import { createHmac } from "node:crypto";
import * as ed from "@noble/ed25519";
import { readFileSync } from "node:fs";

const pub = JSON.parse(readFileSync(new URL("../config.testnet.json", import.meta.url)));
const PKG = pub.memwal.packageId, CLOCK = "0x6";
const ACCT = process.argv[2] || "0x64f510099414b77cf3fe4c4e5e9991266f50554feac971a4e4044654fef993eb";
const kp = Ed25519Keypair.fromSecretKey(Buffer.from(process.env.PROXY_DELEGATE_KEY, "hex"));
const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" });
const masterBytes = Buffer.from(process.env.HANDOFF_MASTER_SECRET, "hex");

async function rpc(m, p) {
  const r = await fetch(pub.suiRpcUrl, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) });
  return (await r.json()).result;
}

const run = async () => {
  const seed = createHmac("sha256", masterBytes).update(ACCT.toLowerCase()).digest();
  const pubBytes = await ed.getPublicKeyAsync(new Uint8Array(seed));
  const addr = new Ed25519PublicKey(pubBytes).toSuiAddress();
  console.log("account:", ACCT);
  console.log("derived delegate addr:", addr);

  const obj = await rpc("sui_getObject", [ACCT, { showContent: true }]);
  const owner = obj.data.content.fields.owner;
  const delegs = (obj.data.content.fields.delegate_keys || []).map((d) => d.fields?.sui_address);
  console.log("owner:", owner, "| proxy:", kp.getPublicKey().toSuiAddress());
  if (delegs.includes(addr)) { console.log("derived key already registered ✓"); return; }
  if (owner !== kp.getPublicKey().toSuiAddress()) throw new Error("proxy key does not own this account; cannot add delegate");

  const tx = new Transaction();
  tx.moveCall({ target: `${PKG}::account::add_delegate_key`, arguments: [
    tx.object(ACCT), tx.pure(bcs.vector(bcs.u8()).serialize(Array.from(pubBytes))),
    tx.pure.address(addr), tx.pure.string("handoff-gateway"), tx.object(CLOCK) ] });
  const res = await kp.signAndExecuteTransaction({ transaction: tx, client });
  await client.waitForTransaction({ digest: res.digest });
  console.log("registered derived key ✓ digest:", res.digest);
};
run().catch((e) => { console.error("FIXTURE ERROR:", e?.message || e); process.exit(1); });
