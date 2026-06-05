/**
 * Generate ONE persistent testnet owner keypair and save it.
 * You fund the printed address once via the web faucet; everything
 * after that (account creation, delegate key, remember/recall) is automated.
 */
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const FILE = ".owner.testnet.json";

let kp, addr, sk;
if (existsSync(FILE)) {
  const saved = JSON.parse(readFileSync(FILE, "utf8"));
  kp = Ed25519Keypair.fromSecretKey(saved.ownerSecretKey);
  addr = kp.getPublicKey().toSuiAddress();
  sk = saved.ownerSecretKey;
  console.log("• reusing existing owner key");
} else {
  kp = new Ed25519Keypair();
  addr = kp.getPublicKey().toSuiAddress();
  sk = kp.getSecretKey();
  writeFileSync(FILE, JSON.stringify({ network: "testnet", ownerSecretKey: sk, ownerAddress: addr }, null, 2));
  console.log("• generated new owner key →", FILE);
}

console.log("\n========================================================");
console.log("  FUND THIS TESTNET ADDRESS (need ~1 testnet SUI):\n");
console.log("  " + addr);
console.log("\n  Web faucet:  https://faucet.sui.io/?network=testnet");
console.log("  (paste the address, pick Testnet, click 'Request')");
console.log("========================================================\n");
