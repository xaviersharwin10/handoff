/**
 * Full superset e2e on testnet (no browser):
 *   1. (capture already populated the fixture vault: travel/food/personal)
 *   2. owner grants ShopBot the "travel" category for 1h  (on-chain Grant)
 *   3. ShopBot recalls via the gateway → gets ONLY travel memory, signed proof
 *   4. owner revokes on-chain
 *   5. ShopBot's next recall is DENIED from chain
 *
 * Owner of the fixture account is the proxy key (0x4fa55b…), so we can sign
 * create_grant / revoke_grant headlessly.
 *
 * Run (gateway must be up; disable on-chain audit so the proxy gas key doesn't
 * contend with the test's grant/revoke txs):
 *   cd scripts && node --env-file=../proxy/.env e2e-superset.mjs
 *   # and start the gateway with GATEWAY_DISABLE_AUDIT=1 for this run
 */
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import * as ed from "@noble/ed25519";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const pub = JSON.parse(readFileSync(new URL("../config.testnet.json", import.meta.url)));
const HPKG = pub.handoff.packageId, CLOCK = "0x6";
const GW = process.env.GATEWAY_URL || "http://localhost:8787";
const ACCT = "0x64f510099414b77cf3fe4c4e5e9991266f50554feac971a4e4044654fef993eb";
const NS = "travel";
const owner = Ed25519Keypair.fromSecretKey(Buffer.from(process.env.PROXY_DELEGATE_KEY, "hex"));
const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" });

// ShopBot's grant credential keypair
const credPriv = ed.utils.randomPrivateKey();

const retry = async (fn, n = 4) => { let e; for (let i = 0; i < n; i++) { try { return await fn(); } catch (x) { e = x; console.log("  (rpc retry", i + 1, "after", String(x?.message || x).slice(0, 50) + ")"); await new Promise((r) => setTimeout(r, 1500 * (i + 1))); } } throw e; };
// Execute with effects/objectChanges in the response — no waitForTransaction (its
// 60s AbortSignal.timeout is what stalled us; executeTransactionBlock already
// returns once the fullnode has executed the tx).
const execTx = (tx, options = {}) => retry(() =>
  owner.signAndExecuteTransaction({ transaction: tx, client, options: { showEffects: true, showObjectChanges: true, ...options } }), 5);
async function rawRpc(method, params) {
  const r = await fetch(pub.suiRpcUrl, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await r.json()).result;
}
const toBytes = (v) => Array.isArray(v) ? Uint8Array.from(v) : Uint8Array.from(Buffer.from(v, "base64"));
/** Find OUR just-created Grant by matching the credential pubkey in recent GrantCreated events.
 *  (This client's signAndExecuteTransaction submits the tx but returns no digest, so we locate
 *  the object by its unique grantee pubkey rather than the tx result.) */
async function findMyGrantIdFor(account, credPubBytes) {
  const want = Buffer.from(credPubBytes).toString("hex");
  return retry(async () => {
    const ev = await rawRpc("suix_queryEvents", [{ MoveEventType: `${HPKG}::grants::GrantCreated` }, null, 25, true]);
    for (const e of ev?.data || []) {
      const gid = e?.parsedJson?.grant_id;
      if (!gid) continue;
      const obj = await rawRpc("sui_getObject", [gid, { showContent: true }]);
      const f = obj?.data?.content?.fields;
      if (f && f.memwal_account === account && Buffer.from(toBytes(f.grantee_pubkey)).toString("hex") === want) return gid;
    }
    throw new Error("my grant not yet indexed");
  }, 6);
}
const sign = async (priv, msg) => Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), priv)).toString("hex");
const recall = async (grantId, query, priv = credPriv) => {
  const timestamp = Date.now();
  const signature = await sign(priv, `handoff.recall|${grantId}|${query}|${timestamp}`);
  const r = await fetch(`${GW}/recall`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ grantId, query, timestamp, signature }) });
  return { status: r.status, body: await r.json() };
};
const remember = async (grantId, text, priv = credPriv, op = "remember") => {
  const timestamp = Date.now();
  const signature = await sign(priv, `handoff.${op}|${grantId}|${text}|${timestamp}`);
  const r = await fetch(`${GW}/remember`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ grantId, text, timestamp, signature }) });
  return { status: r.status, body: await r.json() };
};

const run = async () => {
  const credPub = await ed.getPublicKeyAsync(credPriv);
  console.log("fixture vault:", ACCT, "| granting category:", NS);

  // 2. create grant (owner signs)
  let tx = new Transaction();
  tx.moveCall({ target: `${HPKG}::grants::create_grant`, arguments: [
    tx.pure.address(ACCT), tx.pure.string(NS), tx.pure.string("ShopBot"),
    tx.pure(bcs.vector(bcs.u8()).serialize(Array.from(credPub))), tx.pure.u64(60 * 60_000), tx.object(CLOCK) ] });
  await execTx(tx);
  const grantId = await findMyGrantIdFor(ACCT, credPub);
  console.log("✓ grant created:", grantId);

  // 3. ShopBot recalls travel → expect ALLOW with travel memory (self-Seal vault)
  let r = await recall(grantId, "what trip or race is the user planning");
  console.log(`\n[ALLOW test] status ${r.status} allowed=${r.body.allowed} ns=${r.body.namespace} results=${(r.body.results || []).length}`);
  (r.body.results || []).forEach((m) => console.log("   •", m.text));
  const allowedOk = r.body.allowed === true && (r.body.results || []).some((m) => /marathon|chennai|tokyo|travel|trip/i.test(m.text));

  // 3b. scope proof: a health question through the TRAVEL grant must not surface health memory
  let rf = await recall(grantId, "what medication does the user take");
  const leakedFood = (rf.body.results || []).some((m) => /sertraline|metformin|medication|prediabetes/i.test(m.text));
  console.log(`[scope test] health query via travel grant → ${(rf.body.results || []).length} result(s); leaked health=${leakedFood}`);

  // 3d. WRITE-BACK: ShopBot saves a finding into its granted namespace —
  //     agents remember and build over time, with the same on-chain enforcement.
  const finding = `ShopBot found a nonstop CHN-NRT fare under $600 departing the first week of March (e2e ${Date.now()})`;
  const wr = await remember(grantId, finding);
  const writeOk = wr.body.allowed === true && wr.body.namespace === NS && !!wr.body.memId;
  console.log(`\n[WRITE-BACK test] status ${wr.status} allowed=${wr.body.allowed} ns=${wr.body.namespace} memId=${wr.body.memId?.slice(0, 8)}…`);

  // 3d2. op-binding: a signature for the RECALL op must not authorize a write
  const cross = await remember(grantId, "forged write with a recall-op signature", credPriv, "recall");
  const opBindOk = cross.body.allowed === false && cross.body.reason === "bad_signature";
  console.log(`[OP-BIND test] recall-signed write → status ${cross.status} reason=${cross.body.reason}`);

  // 3e. HANDOFF: a SECOND agent ("Writer") granted the same namespace must see
  //     what ShopBot wrote — agent→agent handoff coordinated through the vault.
  const writerPriv = ed.utils.randomPrivateKey();
  const writerPub = await ed.getPublicKeyAsync(writerPriv);
  let wtx = new Transaction();
  wtx.moveCall({ target: `${HPKG}::grants::create_grant`, arguments: [
    wtx.pure.address(ACCT), wtx.pure.string(NS), wtx.pure.string("Writer"),
    wtx.pure(bcs.vector(bcs.u8()).serialize(Array.from(writerPub))), wtx.pure.u64(60 * 60_000), wtx.object(CLOCK) ] });
  await execTx(wtx);
  const writerGrant = await findMyGrantIdFor(ACCT, writerPub);
  const hr = await recall(writerGrant, "nonstop fare found for the user's trip", writerPriv);
  const handed = (hr.body.results || []).find((m) => m.text === finding);
  const handoffOk = hr.body.allowed === true && !!handed && handed.src === "ShopBot";
  console.log(`[HANDOFF test] Writer recall → status ${hr.status} allowed=${hr.body.allowed} sawShopBotNote=${!!handed} src=${handed?.src}`);

  // 3c. ATTACKER test: mint a grant over an account we DON'T own (a foreign
  //     MemWal account) and try to read it. The gateway must deny: grantor≠owner.
  const FOREIGN = "0x0923501bee4b33df5307313c86e90c8a184dd6e2d20dbf6559fb4705e50427b2"; // someone else's account
  const atkPriv = ed.utils.randomPrivateKey();
  const atkPub = await ed.getPublicKeyAsync(atkPriv);
  let atx = new Transaction();
  atx.moveCall({ target: `${HPKG}::grants::create_grant`, arguments: [
    atx.pure.address(FOREIGN), atx.pure.string("personal"), atx.pure.string("Attacker"),
    atx.pure(bcs.vector(bcs.u8()).serialize(Array.from(atkPub))), atx.pure.u64(60 * 60_000), atx.object(CLOCK) ] });
  await execTx(atx);
  const atkGrant = await findMyGrantIdFor(FOREIGN, atkPub);
  const ats = Date.now();
  const atkSig = await sign(atkPriv, `handoff.recall|${atkGrant}|steal|${ats}`);
  const ar = await fetch(`${GW}/recall`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ grantId: atkGrant, query: "steal", timestamp: ats, signature: atkSig }) });
  const ab = await ar.json();
  const attackerBlocked = ab.allowed === false && ab.reason === "grantor_not_account_owner";
  console.log(`\n[ATTACKER test] grant over a vault we don't own → status ${ar.status} allowed=${ab.allowed} reason=${ab.reason}`);

  // settle before reusing the gas key (audit is disabled on the gateway for this run)
  await new Promise((r) => setTimeout(r, 6000));

  // 4. revoke (owner signs)
  tx = new Transaction();
  tx.moveCall({ target: `${HPKG}::grants::revoke_grant`, arguments: [tx.object(grantId), tx.object(CLOCK)] });
  await execTx(tx);
  console.log("✓ grant revoked on-chain");

  // 5. ShopBot recall AND write again → expect DENY for both
  await new Promise((r) => setTimeout(r, 1500));
  r = await recall(grantId, "where is the user planning to travel");
  console.log(`[DENY test] status ${r.status} allowed=${r.body.allowed} reason=${r.body.reason}`);
  const denyOk = r.body.allowed === false && r.body.reason === "grant_revoked";
  const wd = await remember(grantId, "post-revoke write attempt");
  const writeDenyOk = wd.body.allowed === false && wd.body.reason === "grant_revoked";
  console.log(`[WRITE-DENY test] status ${wd.status} allowed=${wd.body.allowed} reason=${wd.body.reason}`);

  console.log("\n================ RESULT ================");
  console.log(allowedOk ? "✅ scoped recall returned the granted travel slice" : "❌ allow test FAILED");
  console.log(!leakedFood ? "✅ other categories stayed private (no food leak via travel grant)" : "❌ SCOPE LEAK");
  console.log(writeOk ? "✅ write-back stored the agent's finding in the granted slice" : "❌ write-back FAILED");
  console.log(opBindOk ? "✅ op-binding: a recall signature cannot authorize a write" : "❌ OP-BIND HOLE");
  console.log(handoffOk ? "✅ handoff: second agent read the first agent's note (src-tagged)" : "❌ handoff FAILED");
  console.log(attackerBlocked ? "✅ grant over a foreign vault was denied (grantor≠owner)" : "❌ AUTHZ HOLE: attacker grant not blocked");
  console.log(denyOk ? "✅ revoke denied the next recall from chain" : "❌ revoke test FAILED");
  console.log(writeDenyOk ? "✅ revoke denied the next write from chain" : "❌ write-deny test FAILED");
  process.exit(allowedOk && !leakedFood && writeOk && opBindOk && handoffOk && attackerBlocked && denyOk && writeDenyOk ? 0 : 1);
};
run().catch((e) => { console.error("E2E ERROR:", e?.stack || e?.message || e); process.exit(1); });
