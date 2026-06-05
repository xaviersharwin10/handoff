/**
 * ShopBot — a third-party AI agent that holds a Handoff grant credential.
 *
 * It does NOT have the user's MemWal keys. All it has is a grant credential
 * (issued from the Handoff dashboard, "copy credential JSON"). It recalls the
 * user's memory THROUGH the Handoff proxy — which only ever returns the one
 * granted slice, only while the grant is live.
 *
 * Usage:
 *   node agent.mjs                       # runs the scripted demo queries
 *   node agent.mjs "your question"       # one custom query
 *   CREDENTIAL=./credential.json PROXY_URL=http://localhost:8787 node agent.mjs
 */
import { readFileSync } from "node:fs";
import * as ed from "@noble/ed25519";

const PROXY = process.env.PROXY_URL || "http://localhost:8787";
const CRED_PATH = process.env.CREDENTIAL || "./credential.json";

let cred;
try {
  cred = JSON.parse(readFileSync(CRED_PATH, "utf8"));
} catch {
  console.error(
    `\n✗ No grant credential at ${CRED_PATH}.\n` +
      `  In the Handoff dashboard, create a grant → "copy credential JSON" → save it as ${CRED_PATH}.\n`,
  );
  process.exit(1);
}

function recallMessage(grantId, query, timestamp) {
  return new TextEncoder().encode(`handoff.recall|${grantId}|${query}|${timestamp}`);
}

async function ask(query) {
  const timestamp = Date.now();
  const priv = Uint8Array.from(Buffer.from(cred.credentialPrivateKey, "hex"));
  const signature = await ed.signAsync(recallMessage(cred.grantId, query, timestamp), priv);
  const res = await fetch(`${PROXY}/recall`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grantId: cred.grantId,
      query,
      timestamp,
      signature: Buffer.from(signature).toString("hex"),
      limit: 3,
    }),
  });
  return res.json();
}

function render(query, out) {
  console.log(`\n🤖 ShopBot asks: "${query}"`);
  if (out.allowed) {
    console.log(`   ✅ Handoff granted [slice: ${out.namespace}] — ShopBot now knows:`);
    if (out.results.length === 0) console.log("      (nothing relevant in this slice)");
    for (const r of out.results) console.log(`      • ${r.text}`);
  } else {
    console.log(`   ⛔ Handoff DENIED — reason: ${out.reason}`);
    console.log("      ShopBot learns nothing.");
  }
}

const custom = process.argv[2];
const queries = custom
  ? [custom]
  : [
      "What are the user's dietary preferences and allergies?",
      "What is the user's private banking PIN or recovery phrase?",
    ];

console.log(`\n— ShopBot (grantee: ${cred.granteeLabel ?? "?"}) using Handoff grant ${cred.grantId.slice(0, 10)}… via ${PROXY} —`);
for (const q of queries) render(q, await ask(q));
console.log("");
