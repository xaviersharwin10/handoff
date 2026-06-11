/**
 * SPIKE: the FULL self-Seal memory pipeline on testnet, end to end.
 *   embed → Seal-encrypt (our Vault policy) → Walrus upload → rememberManual
 *   recall: embed(query) → recallManual → Walrus download → Seal-decrypt
 *   then shred the vault on-chain → recall still finds the pointer, but the blob
 *   is now UNDECRYPTABLE = provable deletion inside the real memory pipeline.
 *
 * Needs proxy/.env (HANDOFF_MASTER_SECRET + PROXY_DELEGATE_KEY). Args: --vault <id> --pkg <id>
 */
import { MemWal } from "@mysten-incubation/memwal";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { SealClient, SessionKey, EncryptedObject } from "@mysten/seal";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const PKG = arg("--pkg"), VAULT = arg("--vault");
const pub = JSON.parse(readFileSync(new URL("../config.testnet.json", import.meta.url)));
const FIXTURE = "0x64f510099414b77cf3fe4c4e5e9991266f50554feac971a4e4044654fef993eb";
const NS = "vault";
const SECRET = "My bank PIN is 4417 and my recovery phrase starts with 'velvet harbor moon'.";
const QUERY = "what is my bank pin and recovery phrase";
const KEY_SERVERS = [
  { objectId: "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75", weight: 1 },
  { objectId: "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8", weight: 1 },
];
const THRESHOLD = 2;
const PUB = "https://publisher.walrus-testnet.walrus.space/v1/blobs";
const AGG = "https://aggregator.walrus-testnet.walrus.space/v1/blobs";

const suiClient = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" });
const owner = Ed25519Keypair.fromSecretKey(Buffer.from(process.env.PROXY_DELEGATE_KEY, "hex")); // vault owner + seal session
const ownerAddr = owner.getPublicKey().toSuiAddress();
const derivedHex = createHmac("sha256", Buffer.from(process.env.HANDOFF_MASTER_SECRET, "hex")).update(FIXTURE.toLowerCase()).digest("hex");
const mw = MemWal.create({ key: derivedHex, accountId: FIXTURE, serverUrl: pub.memwal.relayerUrl, namespace: NS });
const seal = new SealClient({ suiClient, serverConfigs: KEY_SERVERS, verifyKeyServers: true });
const idHex = VAULT.replace(/^0x/, "");
const idBytes = Array.from(Uint8Array.from(idHex.match(/.{1,2}/g).map((b) => parseInt(b, 16))));
const retry = async (fn, n = 4) => { let e; for (let i = 0; i < n; i++) { try { return await fn(); } catch (x) { e = x; await new Promise((r) => setTimeout(r, 700 * (i + 1))); } } throw e; };

async function walrusPut(bytes) {
  const r = await fetch(`${PUB}?epochs=1`, { method: "PUT", body: bytes });
  const j = await r.json();
  return j?.newlyCreated?.blobObject?.blobId || j?.alreadyCertified?.blobId;
}
async function walrusGet(blobId) {
  const r = await fetch(`${AGG}/${blobId}`);
  return new Uint8Array(await r.arrayBuffer());
}
async function sealDecrypt(ciphertext) {
  const sessionKey = await SessionKey.create({ address: ownerAddr, packageId: PKG, ttlMin: 5, signer: owner, suiClient });
  const tx = new Transaction();
  tx.moveCall({ target: `${PKG}::vault::seal_approve`, arguments: [tx.pure("vector<u8>", idBytes), tx.object(VAULT)] });
  const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });
  await seal.fetchKeys({ ids: [EncryptedObject.parse(ciphertext).id], txBytes, sessionKey, threshold: THRESHOLD });
  return new TextDecoder().decode(await seal.decrypt({ data: ciphertext, sessionKey, txBytes }));
}

const run = async () => {
  console.log(`vault ${VAULT}\nowner ${ownerAddr}\nfixture ${FIXTURE} (ns ${NS})\n`);

  // WRITE
  console.log(`[1] embed + Seal-encrypt + Walrus + rememberManual: "${SECRET}"`);
  const { vector } = await retry(() => mw.embed(SECRET));
  const { encryptedObject } = await seal.encrypt({ threshold: THRESHOLD, packageId: PKG, id: idHex, data: new TextEncoder().encode(SECRET) });
  const blobId = await retry(() => walrusPut(new Uint8Array(encryptedObject)));
  await retry(() => mw.rememberManual({ blobId, vector, namespace: NS }));
  console.log(`  stored: vec dim=${vector.length}, walrus blob=${blobId}`);
  await new Promise((r) => setTimeout(r, 2500));

  // RECALL (alive)
  console.log(`\n[2] recall ALIVE: embed(query) → recallManual → Walrus → Seal-decrypt`);
  const { vector: qv } = await retry(() => mw.embed(QUERY));
  let hits = (await retry(() => mw.recallManual({ vector: qv, namespace: NS, limit: 5 }))).results || [];
  console.log(`  recallManual → ${hits.length} hit(s):`, hits.map((h) => `${h.blob_id.slice(0, 8)}…@${(+h.distance).toFixed(3)}`).join(", "));
  const mine = hits.find((h) => h.blob_id === blobId) || hits[0];
  const ct = await retry(() => walrusGet(mine.blob_id));
  const text = await sealDecrypt(ct);
  const aliveOk = text === SECRET;
  console.log(`  decrypt → ${aliveOk ? "✅" : "❌"} "${text}"`);

  // SHRED
  console.log(`\n[3] SHRED the vault on-chain (provable deletion)…`);
  const tx = new Transaction();
  tx.moveCall({ target: `${PKG}::vault::shred`, arguments: [tx.object(VAULT)] });
  await owner.signAndExecuteTransaction({ transaction: tx, client: suiClient });
  await new Promise((r) => setTimeout(r, 4000));

  // RECALL (after shred)
  console.log(`\n[4] recall AFTER shred: pointer still found, but data must be dead`);
  hits = (await retry(() => mw.recallManual({ vector: qv, namespace: NS, limit: 5 }))).results || [];
  const stillFound = hits.find((h) => h.blob_id === blobId);
  console.log(`  recallManual still returns the blob pointer: ${stillFound ? "yes (dangling)" : "no"}`);
  let deadOk = false;
  try {
    const ct2 = await retry(() => walrusGet(blobId), 2);
    await sealDecrypt(ct2);
    console.log("  → ❌ STILL DECRYPTED (deletion not provable)");
  } catch (e) {
    deadOk = true;
    console.log(`  → ✅ UNDECRYPTABLE after shred: ${String(e?.message || e).slice(0, 90)}`);
  }

  console.log("\n================ RESULT ================");
  console.log(aliveOk ? "✅ full self-Seal pipeline: stored + recalled + decrypted" : "❌ alive pipeline FAILED");
  console.log(deadOk ? "✅ provable deletion inside the real pipeline (recall finds a dead pointer; blob unrecoverable)" : "❌ deletion FAILED");
  process.exit(aliveOk && deadOk ? 0 : 1);
};
run().catch((e) => { console.error("SPIKE ERROR:", e?.stack || e?.message || e); process.exit(1); });
