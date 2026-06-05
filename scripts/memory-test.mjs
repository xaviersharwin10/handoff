/**
 * Final de-risk: remember() + recall() against the staging relayer,
 * using the on-chain account + delegate key we just created via the CLI.
 */
import { readFileSync } from "node:fs";
import { MemWal } from "@mysten-incubation/memwal";

const c = JSON.parse(readFileSync(".owner.testnet.json", "utf8"));
const RELAYER_URL = "https://relayer-staging.memory.walrus.xyz";
const NAMESPACE = "handoff-smoke";

const memwal = MemWal.create({
  key: c.delegatePrivateKey,
  accountId: c.accountId,
  serverUrl: RELAYER_URL,
  namespace: NAMESPACE,
});

console.log("• accountId:", c.accountId);
console.log("• relayer  :", RELAYER_URL, "| namespace:", NAMESPACE);

const fact = "I am vegan and severely allergic to peanuts.";
console.log("• remember():", JSON.stringify(fact));
await memwal.rememberAndWait(fact);

console.log("• recall('food preferences and allergies'):");
const res = await memwal.recall({ query: "food preferences and allergies", limit: 3 });
for (const m of res.results) {
  console.log(`    ↳ [d=${m.distance.toFixed(3)}] ${m.text}`);
}

if (res.results.length > 0 && res.results.some((m) => /peanut/i.test(m.text))) {
  console.log("\n✅ MEMWAL DE-RISK PASSED — on-chain account + remember/recall work end-to-end.");
} else {
  console.log("\n⚠️ recall did not return the stored fact — investigate.");
  process.exitCode = 1;
}
