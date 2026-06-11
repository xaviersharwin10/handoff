/**
 * SPIKE: the OWN-INDEX, Walrus-native memory layer, end to end on testnet.
 * No MemWal relayer. Free local embeddings + brute-force cosine + direct Walrus
 * + our Vault Seal policy, with the gateway decrypting as a registered DELEGATE.
 *
 *   write : embed → Seal-encrypt(id=memoryId) → Walrus → own index entry
 *   recall: embed(query) → cosine over index (ns filter) → Walrus → Seal-decrypt
 *   delete: shred_one(memoryId) → that blob undecryptable; shred_all → all dead
 *
 * Needs proxy/.env (PROXY_DELEGATE_KEY = the gateway/delegate key). Owner key from
 * scripts/.owner.testnet.json. Args: --pkg <id> --vault <id>
 */
import { pipeline } from "@xenova/transformers";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Transaction } from "@mysten/sui/transactions";
import { SealClient, SessionKey, EncryptedObject } from "@mysten/seal";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const PKG = arg("--pkg"), VAULT = arg("--vault");
const KEY_SERVERS = [
  { objectId: "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75", weight: 1 },
  { objectId: "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8", weight: 1 },
];
const THRESHOLD = 2, PUB = "https://publisher.walrus-testnet.walrus.space/v1/blobs", AGG = "https://aggregator.walrus-testnet.walrus.space/v1/blobs";

const suiClient = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" });
const ownerKp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(JSON.parse(readFileSync(new URL("./.owner.testnet.json", import.meta.url))).ownerSecretKey).secretKey);
const gw = Ed25519Keypair.fromSecretKey(Buffer.from(process.env.PROXY_DELEGATE_KEY, "hex")); // gateway = delegate
const gwAddr = gw.getPublicKey().toSuiAddress();
// Fresh client per decrypt: the SealClient caches fetched key shares, so a
// long-lived client would serve a shredded memory from cache. Each recall is an
// independent request — model that, and prove the on-chain policy denies NEW key
// requests after a shred. (Production: gateway evicts the id from its Seal cache
// on shred AND drops it from the index, so it's never even requested.)
const newSeal = () => new SealClient({ suiClient, serverConfigs: KEY_SERVERS, verifyKeyServers: true });
const seal = newSeal(); // used only for encrypt (write path)
const retry = async (fn, n = 4) => { let e; for (let i = 0; i < n; i++) { try { return await fn(); } catch (x) { e = x; await new Promise((r) => setTimeout(r, 700 * (i + 1))); } } throw e; };
const hexToBytes = (h) => Array.from(Uint8Array.from(h.match(/.{1,2}/g).map((b) => parseInt(b, 16))));
const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0); // normalized → dot

let ex;
const embed = async (s) => Array.from((await ex(s, { pooling: "mean", normalize: true })).data);
const walrusPut = async (bytes) => { const j = await (await fetch(`${PUB}?epochs=1`, { method: "PUT", body: bytes })).json(); return j?.newlyCreated?.blobObject?.blobId || j?.alreadyCertified?.blobId; };
const walrusGet = async (id) => new Uint8Array(await (await fetch(`${AGG}/${id}`)).arrayBuffer());

async function decryptAsGateway(ct, memId) {
  const client = newSeal(); // independent request → no warm key cache
  const sessionKey = await SessionKey.create({ address: gwAddr, packageId: PKG, ttlMin: 5, signer: gw, suiClient });
  const tx = new Transaction();
  tx.moveCall({ target: `${PKG}::vault::seal_approve`, arguments: [tx.pure("vector<u8>", hexToBytes(memId)), tx.object(VAULT)] });
  const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });
  await client.fetchKeys({ ids: [EncryptedObject.parse(ct).id], txBytes, sessionKey, threshold: THRESHOLD });
  return new TextDecoder().decode(await client.decrypt({ data: ct, sessionKey, txBytes }));
}
async function shred(fn, memIdHex) {
  const tx = new Transaction();
  if (fn === "shred_one") tx.moveCall({ target: `${PKG}::vault::shred_one`, arguments: [tx.object(VAULT), tx.pure("vector<u8>", hexToBytes(memIdHex))] });
  else tx.moveCall({ target: `${PKG}::vault::shred_all`, arguments: [tx.object(VAULT)] });
  await ownerKp.signAndExecuteTransaction({ transaction: tx, client: suiClient });
  await new Promise((r) => setTimeout(r, 5000)); // let key servers see the new on-chain state
}

const MEMS = [
  { ns: "finance", text: "My bank PIN is 4417 and my recovery phrase starts with velvet harbor moon." },
  { ns: "health", text: "I am vegetarian and severely allergic to peanuts." },
  { ns: "personal", text: "My golden retriever puppy is named Mochi." },
];

const run = async () => {
  console.log("loading local embedder…"); ex = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  console.log(`vault ${VAULT}\ngateway(delegate) ${gwAddr}\n`);
  const index = [];
  console.log("[WRITE] embed → Seal-encrypt → Walrus → index");
  for (const m of MEMS) {
    const memId = randomBytes(16).toString("hex");
    const vec = await embed(m.text);
    const { encryptedObject } = await seal.encrypt({ threshold: THRESHOLD, packageId: PKG, id: memId, data: new TextEncoder().encode(m.text) });
    const blobId = await retry(() => walrusPut(new Uint8Array(encryptedObject)));
    index.push({ memId, ns: m.ns, vec, blobId, text: m.text });
    console.log(`  + [${m.ns}] mem ${memId.slice(0, 8)}… walrus ${blobId.slice(0, 10)}…`);
  }

  const recall = async (q, ns) => {
    const qv = await embed(q);
    const ranked = index.filter((e) => !ns || e.ns === ns).map((e) => ({ e, s: cos(qv, e.vec) })).sort((a, b) => b.s - a.s);
    return ranked;
  };

  console.log(`\n[RECALL] "what is my bank pin" (all namespaces)`);
  let r = await recall("what is my bank pin");
  console.log(`  top: [${r[0].e.ns}] score ${r[0].s.toFixed(3)} (next ${r[1].s.toFixed(3)})`);
  const dec = await decryptAsGateway(await retry(() => walrusGet(r[0].e.blobId)), r[0].e.memId);
  const recallOk = r[0].e.ns === "finance" && dec === r[0].e.text;
  console.log(`  decrypt as gateway-delegate → ${recallOk ? "✅" : "❌"} "${dec.slice(0, 40)}…"`);

  console.log(`\n[RECALL] ns="health" "what can't I eat"`);
  let rh = await recall("what can't I eat", "health");
  console.log(`  top in health: [${rh[0].e.ns}] ${rh[0].s.toFixed(3)} — only health entries considered (${rh.length})`);

  const fin = index.find((e) => e.ns === "finance");
  console.log(`\n[SHRED ONE] finance memory ${fin.memId.slice(0, 8)}…`);
  await shred("shred_one", fin.memId);
  let oneDead = false;
  try { await decryptAsGateway(await retry(() => walrusGet(fin.blobId), 2), fin.memId); console.log("  ❌ still decrypts"); }
  catch (e) { oneDead = true; console.log(`  ✅ finance memory UNDECRYPTABLE: ${String(e?.message || e).slice(0, 70)}`); }
  // others still alive
  const health = index.find((e) => e.ns === "health");
  let othersAlive = false;
  try { const t = await decryptAsGateway(await retry(() => walrusGet(health.blobId)), health.memId); othersAlive = t === health.text; console.log(`  health memory still decrypts → ${othersAlive ? "✅" : "❌"}`); } catch { console.log("  ❌ health wrongly dead"); }

  console.log(`\n[SHRED ALL] panic wipe`);
  await shred("shred_all");
  let allDead = false;
  try { await decryptAsGateway(await retry(() => walrusGet(health.blobId), 2), health.memId); console.log("  ❌ still decrypts after wipe"); }
  catch (e) { allDead = true; console.log(`  ✅ everything UNDECRYPTABLE after wipe: ${String(e?.message || e).slice(0, 60)}`); }

  console.log("\n================ RESULT ================");
  console.log(recallOk ? "✅ own-index recall + gateway-delegate decrypt" : "❌ recall FAILED");
  console.log(oneDead && othersAlive ? "✅ per-memory provable deletion (one dead, others alive)" : "❌ per-memory shred FAILED");
  console.log(allDead ? "✅ panic shred_all wipes everything" : "❌ shred_all FAILED");
  process.exit(recallOk && oneDead && othersAlive && allDead ? 0 : 1);
};
run().catch((e) => { console.error("SPIKE ERROR:", e?.stack || e?.message || e); process.exit(1); });
