/**
 * MemWal de-risk smoke test (testnet / staging relayer).
 *
 * Proves the core dependency works end-to-end with ZERO manual steps:
 *   1. generate a Sui owner keypair
 *   2. fund it from the testnet faucet
 *   3. create a MemWalAccount on testnet
 *   4. generate + register a delegate key
 *   5. remember() a fact, then recall() it back
 *
 * Writes the working credentials to ./.memwal.testnet.json so later
 * components (proxy, dashboard) can reuse the same account.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { MemWal } from "@mysten-incubation/memwal";

const TESTNET_RPC = "https://fullnode.testnet.sui.io:443";

/** Version-proof balance check via raw JSON-RPC (avoids SDK client API churn). */
async function getBalanceMist(address) {
  const r = await fetch(TESTNET_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "suix_getBalance",
      params: [address],
    }),
  });
  const j = await r.json();
  return BigInt(j.result?.totalBalance ?? "0");
}
import {
  createAccount,
  generateDelegateKey,
  addDelegateKey,
} from "@mysten-incubation/memwal/account";

// --- MemWal testnet (staging) deployment, from docs/contract/overview.md ---
const PACKAGE_ID =
  "0xcf6ad755a1cdff7217865c796778fabe5aa399cb0cf2eba986f4b582047229c6";
const REGISTRY_ID =
  "0xe80f2feec1c139616a86c9f71210152e2a7ca552b20841f2e192f99f75864437";
const RELAYER_URL = "https://relayer-staging.memory.walrus.xyz";
const NETWORK = "testnet";
const NAMESPACE = "handoff-smoke";

const log = (...a) => console.log("•", ...a);

async function main() {
  // 1. load the persistent owner keypair (created by setup-owner.mjs, funded via web faucet)
  if (!existsSync(".owner.testnet.json")) {
    throw new Error("Run `node setup-owner.mjs` first, then fund the printed address.");
  }
  const ownerSk = JSON.parse(readFileSync(".owner.testnet.json", "utf8")).ownerSecretKey;
  const owner = Ed25519Keypair.fromSecretKey(ownerSk);
  const ownerAddr = owner.getPublicKey().toSuiAddress();
  log("owner address:", ownerAddr);

  // 2. verify the address is funded
  const balance = await getBalanceMist(ownerAddr);
  log("testnet balance (MIST):", balance.toString());
  if (balance === 0n) {
    throw new Error(
      `Owner address has no gas. Fund it at https://faucet.sui.io/?network=testnet → ${ownerAddr}`,
    );
  }

  // 3. create MemWal account
  log("creating MemWalAccount on testnet…");
  const { accountId } = await createAccount({
    packageId: PACKAGE_ID,
    registryId: REGISTRY_ID,
    suiPrivateKey: ownerSk,
    suiNetwork: NETWORK,
  });
  log("accountId:", accountId);

  // 4. delegate key
  const delegate = await generateDelegateKey();
  log("delegate suiAddress:", delegate.suiAddress);
  await addDelegateKey({
    packageId: PACKAGE_ID,
    accountId,
    publicKey: delegate.publicKey,
    label: "handoff-smoke",
    suiPrivateKey: ownerSk,
    suiNetwork: NETWORK,
  });
  log("delegate key registered on-chain");

  // 5. remember + recall
  const memwal = MemWal.create({
    key: delegate.privateKey,
    accountId,
    serverUrl: RELAYER_URL,
    namespace: NAMESPACE,
  });

  const fact = "I am vegan and severely allergic to peanuts.";
  log("remember():", JSON.stringify(fact));
  await memwal.rememberAndWait(fact);

  log("recall('food preferences and allergies'):");
  const res = await memwal.recall({
    query: "food preferences and allergies",
    limit: 3,
  });
  for (const m of res.results) {
    console.log(`    ↳ [d=${m.distance.toFixed(3)}] ${m.text}`);
  }

  const creds = {
    network: NETWORK,
    packageId: PACKAGE_ID,
    registryId: REGISTRY_ID,
    relayerUrl: RELAYER_URL,
    accountId,
    ownerSecretKey: ownerSk,
    delegatePrivateKey: delegate.privateKey,
    delegateSuiAddress: delegate.suiAddress,
  };
  writeFileSync(".memwal.testnet.json", JSON.stringify(creds, null, 2));
  log("saved credentials → handoff/scripts/.memwal.testnet.json");

  if (res.results.length > 0) {
    console.log("\n✅ MEMWAL DE-RISK PASSED — remember/recall works end-to-end.");
  } else {
    console.log("\n⚠️  Recall returned 0 results — investigate before building.");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("\n❌ smoke test failed:", e);
  process.exit(1);
});
