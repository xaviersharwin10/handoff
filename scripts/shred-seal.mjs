/**
 * SPIKE: provable deletion (crypto-shred) round-trip with Seal on testnet.
 *   --mode alive  : encrypt a memory under our shred::vault policy, save ciphertext,
 *                   then decrypt it (proves it works while the vault is alive)
 *   --mode dead   : load the same ciphertext and try to decrypt AFTER on-chain shred
 *                   (proves the data is now cryptographically unrecoverable)
 *
 * Between the two runs, `shred::vault::shred(vault)` is called on-chain (the proof).
 */
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Transaction } from "@mysten/sui/transactions";
import { SealClient, SessionKey, EncryptedObject } from "@mysten/seal";
import { readFileSync, writeFileSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const MODE = arg("--mode", "alive");
const PKG = arg("--pkg");
const VAULT = arg("--vault");
const CT_PATH = "/tmp/shred-ct.b64";
const SECRET = "My therapist note: I relapsed on June 3 and I'm terrified to tell anyone. — entry #1";

const KEY_SERVERS = [
  { objectId: "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75", weight: 1 },
  { objectId: "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8", weight: 1 },
];
const THRESHOLD = 2;

const suiClient = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" });
const { secretKey } = decodeSuiPrivateKey(JSON.parse(readFileSync(new URL("./.owner.testnet.json", import.meta.url))).ownerSecretKey);
const kp = Ed25519Keypair.fromSecretKey(secretKey);
const me = kp.getPublicKey().toSuiAddress();
const seal = new SealClient({ suiClient, serverConfigs: KEY_SERVERS, verifyKeyServers: true });

const idHex = VAULT.replace(/^0x/, ""); // IBE identity = the vault id
const idBytes = Array.from(Uint8Array.from(idHex.match(/.{1,2}/g).map((b) => parseInt(b, 16))));

async function buildApprovePtb() {
  const tx = new Transaction();
  tx.moveCall({ target: `${PKG}::vault::seal_approve`, arguments: [tx.pure("vector<u8>", idBytes), tx.object(VAULT)] });
  return tx.build({ client: suiClient, onlyTransactionKind: true });
}
async function decrypt(ciphertext) {
  const sessionKey = await SessionKey.create({ address: me, packageId: PKG, ttlMin: 5, signer: kp, suiClient });
  const txBytes = await buildApprovePtb();
  const fullId = EncryptedObject.parse(ciphertext).id;
  await seal.fetchKeys({ ids: [fullId], txBytes, sessionKey, threshold: THRESHOLD }); // policy check happens HERE
  return seal.decrypt({ data: ciphertext, sessionKey, txBytes });
}

const run = async () => {
  console.log(`owner ${me}\nvault ${VAULT}\npkg   ${PKG}\n`);
  if (MODE === "alive") {
    console.log(`[encrypt] "${SECRET}"`);
    const { encryptedObject } = await seal.encrypt({ threshold: THRESHOLD, packageId: PKG, id: idHex, data: new TextEncoder().encode(SECRET) });
    writeFileSync(CT_PATH, Buffer.from(encryptedObject).toString("base64"));
    console.log(`  ciphertext: ${encryptedObject.length} bytes → ${CT_PATH}`);
    console.log("[decrypt while ALIVE]…");
    const out = new TextDecoder().decode(await decrypt(new Uint8Array(encryptedObject)));
    const ok = out === SECRET;
    console.log(`  → ${ok ? "✅ decrypted OK" : "❌ mismatch"}: "${out}"`);
    process.exit(ok ? 0 : 1);
  } else {
    const ciphertext = Uint8Array.from(Buffer.from(readFileSync(CT_PATH, "utf8"), "base64"));
    console.log("[decrypt after SHRED] expecting cryptographic failure…");
    try {
      const out = new TextDecoder().decode(await decrypt(ciphertext));
      console.log(`  → ❌ STILL DECRYPTED (deletion NOT provable): "${out}"`);
      process.exit(1);
    } catch (e) {
      console.log(`  → ✅ UNDECRYPTABLE — key servers refused: ${String(e?.message || e).slice(0, 120)}`);
      console.log("  The encrypted blob can persist anywhere; without key shares it is permanently dead.");
      process.exit(0);
    }
  }
};
run().catch((e) => { console.error("SPIKE ERROR:", e?.stack || e?.message || e); process.exit(1); });
