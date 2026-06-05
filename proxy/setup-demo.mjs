/**
 * Prepare a demo scenario for proxy testing:
 *   1. Seed memories in TWO namespaces:
 *        - "handoff-smoke"  → the slice we will grant (allergy fact)
 *        - "private-notes"  → a secret slice we will NOT grant
 *   2. Mint a fresh Grant scoped to "handoff-smoke" with a credential keypair WE keep.
 *   3. Save { grantId, credentialPrivateKey } → .demo-grant.json (gitignored).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as ed from "@noble/ed25519";
import { MemWal } from "@mysten-incubation/memwal";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const creds = JSON.parse(readFileSync(resolve(root, "scripts", ".owner.testnet.json"), "utf8"));
const pub = JSON.parse(readFileSync(resolve(root, "config.testnet.json"), "utf8"));

const RELAYER = pub.memwal.relayerUrl;
const PKG = creds.handoffPackageId;
const ACCOUNT = creds.accountId;
const GRANTED_NS = "handoff-smoke";
const PRIVATE_NS = "private-notes";

const sui = (args) =>
  execFileSync("sui", args, { encoding: "utf8", env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` } });

async function seed(namespace, text) {
  const mw = MemWal.create({ key: creds.delegatePrivateKey, accountId: ACCOUNT, serverUrl: RELAYER, namespace });
  await mw.rememberAndWait(text);
  console.log(`  seeded [${namespace}]: ${JSON.stringify(text)}`);
}

async function main() {
  console.log("• seeding memories…");
  await seed(GRANTED_NS, "I am vegan and severely allergic to peanuts.");
  await seed(PRIVATE_NS, "My private banking PIN is 4321 and my recovery phrase starts with 'orchid'.");

  console.log("• generating grant credential keypair…");
  const credPriv = ed.utils.randomPrivateKey();
  const credPub = await ed.getPublicKeyAsync(credPriv);
  const pubArray = "[" + Array.from(credPub).join(",") + "]";

  console.log(`• minting grant scoped to "${GRANTED_NS}" (ttl 1h)…`);
  const out = sui([
    "client", "call",
    "--package", PKG, "--module", "grants", "--function", "create_grant",
    "--args", ACCOUNT, GRANTED_NS, "DemoShopBot", pubArray, "3600000", "0x6",
    "--gas-budget", "100000000", "--json",
  ]);
  const j = JSON.parse(out);
  const grant = (j.objectChanges || []).find((o) => o.objectType?.includes("::grants::Grant"));
  if (!grant) throw new Error("grant object not found in tx output");
  console.log(`  grantId: ${grant.objectId}  (status ${j.effects?.status?.status})`);

  writeFileSync(
    resolve(__dirname, ".demo-grant.json"),
    JSON.stringify(
      {
        grantId: grant.objectId,
        credentialPrivateKey: Buffer.from(credPriv).toString("hex"),
        namespace: GRANTED_NS,
        privateNamespace: PRIVATE_NS,
      },
      null,
      2,
    ),
  );
  console.log("• saved → proxy/.demo-grant.json");
}

main().catch((e) => {
  console.error("setup failed:", e);
  process.exit(1);
});
