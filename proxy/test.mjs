/**
 * End-to-end proxy test. Assumes the proxy is running on $PROXY_URL (default :8787).
 * Proves: scoped recall works, the private slice never leaks, bad signatures are
 * rejected, and revocation (on-chain) instantly cuts off access.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { recallViaHandoff } from "./src/client.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const g = JSON.parse(readFileSync(resolve(__dirname, ".demo-grant.json"), "utf8"));
const creds = JSON.parse(readFileSync(resolve(__dirname, "..", "scripts", ".owner.testnet.json"), "utf8"));
const PROXY = process.env.PROXY_URL || "http://localhost:8787";

const sui = (args) =>
  execFileSync("sui", args, { encoding: "utf8", env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` } });

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  console.log(`  ${cond ? "✅" : "❌"} ${name}${detail ? `  — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

console.log("\n[1] valid recall on granted slice");
{
  const { body } = await recallViaHandoff({ proxyUrl: PROXY, grantId: g.grantId, credentialPrivateKey: g.credentialPrivateKey, query: "what are my food allergies?" });
  const texts = (body.results || []).map((r) => r.text).join(" | ");
  check("allowed", body.allowed === true, `ns=${body.namespace}`);
  check("returns the allergy fact", /peanut/i.test(texts), texts.slice(0, 60));
}

console.log("\n[2] SCOPE: a query aimed at the private slice must NOT leak it");
{
  const { body } = await recallViaHandoff({ proxyUrl: PROXY, grantId: g.grantId, credentialPrivateKey: g.credentialPrivateKey, query: "what is my banking PIN and recovery phrase?" });
  const texts = (body.results || []).map((r) => r.text).join(" | ");
  check("private PIN never returned", !/4321|orchid|recovery phrase/i.test(texts), texts ? texts.slice(0, 60) : "(empty)");
}

console.log("\n[3] bad signature is rejected");
{
  const ts = Date.now();
  const res = await fetch(`${PROXY}/recall`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ grantId: g.grantId, query: "allergies", timestamp: ts, signature: "00".repeat(64) }),
  });
  const body = await res.json();
  check("denied with bad_signature", body.allowed === false && body.reason === "bad_signature", `status ${res.status}`);
}

console.log("\n[4] REVOKE on-chain → access cut off immediately");
{
  sui(["client", "call", "--package", creds.handoffPackageId, "--module", "grants", "--function", "revoke_grant", "--args", g.grantId, "0x6", "--gas-budget", "100000000", "--json"]);
  const { body } = await recallViaHandoff({ proxyUrl: PROXY, grantId: g.grantId, credentialPrivateKey: g.credentialPrivateKey, query: "what are my food allergies?" });
  check("denied with grant_revoked", body.allowed === false && body.reason === "grant_revoked", `reason=${body.reason}`);
}

console.log(`\n${fail === 0 ? "✅ ALL PROXY TESTS PASSED" : `❌ ${fail} FAILED`} (${pass}/${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
