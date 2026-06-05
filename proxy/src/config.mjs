/**
 * Proxy configuration.
 *
 * Public deployment values come from handoff/config.testnet.json (committed).
 * Secrets — the MemWal delegate key the proxy uses to recall on the grantor's
 * behalf, and the account it belongs to — come from env, falling back to the
 * local dev creds file (gitignored) for convenience.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", ".."); // handoff/

const pub = JSON.parse(readFileSync(resolve(root, "config.testnet.json"), "utf8"));

// Secrets: prefer env; fall back to scripts/.owner.testnet.json for local dev.
let delegateKey = process.env.PROXY_DELEGATE_KEY;
let memwalAccount = process.env.PROXY_MEMWAL_ACCOUNT;
if (!delegateKey || !memwalAccount) {
  const devCreds = resolve(root, "scripts", ".owner.testnet.json");
  if (existsSync(devCreds)) {
    const c = JSON.parse(readFileSync(devCreds, "utf8"));
    delegateKey = delegateKey || c.delegatePrivateKey;
    memwalAccount = memwalAccount || c.accountId;
  }
}
if (!delegateKey || !memwalAccount) {
  throw new Error(
    "Missing proxy secrets: set PROXY_DELEGATE_KEY and PROXY_MEMWAL_ACCOUNT " +
      "(or provide handoff/scripts/.owner.testnet.json).",
  );
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  suiRpcUrl: pub.suiRpcUrl,
  handoffPackageId: pub.handoff.packageId,
  relayerUrl: pub.memwal.relayerUrl,
  // the single MemWal account this proxy can recall from (multi-tenant later)
  memwalAccount,
  delegateKey,
  // reject signed requests older than this (anti-replay)
  maxRequestAgeMs: 60_000,
};
