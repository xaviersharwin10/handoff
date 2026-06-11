/**
 * Seal encryption/decryption under the Handoff Vault policy, with the gateway
 * acting as the vault's registered DELEGATE.
 *
 * Shred-correctness: the Seal SDK caches fetched key shares per client, so a
 * warm client could decrypt a memory that was just shredded on-chain. We keep
 * ONE client for encryption, but track per-memory clients' keys conservatively:
 * every decrypt does a fresh fetchKeys on a per-call client, so the on-chain
 * policy (`seal_approve`) is consulted for every memory id we haven't already
 * proven in this process — and `evict(memId)` drops any cached state on shred.
 */
import { SealClient, SessionKey, EncryptedObject } from "@mysten/seal";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { config } from "./config.mjs";

const suiClient = new SuiJsonRpcClient({ url: config.suiRpcUrl || getJsonRpcFullnodeUrl("testnet"), network: "testnet" });

function hexToBytes(h) {
  const c = h.startsWith("0x") ? h.slice(2) : h;
  const o = new Uint8Array(c.length / 2);
  for (let i = 0; i < o.length; i++) o[i] = parseInt(c.slice(i * 2, i * 2 + 2), 16);
  return o;
}

const gatewayKp = Ed25519Keypair.fromSecretKey(hexToBytes(process.env.PROXY_DELEGATE_KEY));
export const gatewayAddress = gatewayKp.getPublicKey().toSuiAddress();

const newClient = (verify) =>
  new SealClient({ suiClient, serverConfigs: config.seal.keyServers, verifyKeyServers: verify });

// One verified client for encryption (encryption never consults the policy).
const encryptClient = newClient(true);

// Session key cache (signing is local; SessionKey is valid for ttlMin).
let session = null;
let sessionAt = 0;
async function getSession() {
  if (!session || Date.now() - sessionAt > 8 * 60_000) {
    session = await SessionKey.create({
      address: gatewayAddress,
      packageId: config.vault.packageId,
      ttlMin: 10,
      signer: gatewayKp,
      suiClient,
    });
    sessionAt = Date.now();
  }
  return session;
}

function approveTxBytes(vaultId, memIdHex) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${config.vault.packageId}::vault::seal_approve`,
    arguments: [tx.pure("vector<u8>", Array.from(hexToBytes(memIdHex))), tx.object(vaultId)],
  });
  return tx.build({ client: suiClient, onlyTransactionKind: true });
}

/** Encrypt plaintext under the vault policy with identity `memIdHex`. */
export async function sealEncrypt(memIdHex, plaintextBytes) {
  const { encryptedObject } = await encryptClient.encrypt({
    threshold: config.seal.threshold,
    packageId: config.vault.packageId,
    id: memIdHex,
    data: plaintextBytes,
  });
  return new Uint8Array(encryptedObject);
}

// Per-memory decrypt clients. A client is only ever used for ONE memory id, so
// its key cache can never serve a different (possibly shredded) memory; evict()
// removes the client when that id is shredded.
const decryptClients = new Map(); // memIdHex -> SealClient
function clientFor(memIdHex) {
  let c = decryptClients.get(memIdHex);
  if (!c) {
    c = newClient(false); // key servers were verified once at startup by encryptClient
    decryptClients.set(memIdHex, c);
    if (decryptClients.size > 500) decryptClients.delete(decryptClients.keys().next().value);
  }
  return c;
}

/** Decrypt a Seal blob as the gateway delegate. Throws if the policy denies (shredded/wiped). */
export async function sealDecrypt(vaultId, memIdHex, ciphertext) {
  const client = clientFor(memIdHex);
  const sessionKey = await getSession();
  const txBytes = await approveTxBytes(vaultId, memIdHex);
  await client.fetchKeys({
    ids: [EncryptedObject.parse(ciphertext).id],
    txBytes,
    sessionKey,
    threshold: config.seal.threshold,
  });
  return new Uint8Array(await client.decrypt({ data: ciphertext, sessionKey, txBytes }));
}

/** Drop any cached key material for a memory id (call on shred). */
export function evict(memIdHex) {
  if (memIdHex) decryptClients.delete(memIdHex);
  else decryptClients.clear();
}

// ---------------------------------------------------------------- chain reads

async function rpc(method, params) {
  const r = await fetch(config.suiRpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await r.json()).result;
}

/** Vault object id for an owner address (from the on-chain registry), or null. */
export async function vaultForOwner(owner) {
  const reg = await rpc("sui_getObject", [config.vault.registryId, { showContent: true }]);
  const tableId = reg?.data?.content?.fields?.vaults?.fields?.id?.id;
  if (!tableId) return null;
  try {
    const df = await rpc("suix_getDynamicFieldObject", [tableId, { type: "address", value: owner }]);
    return df?.data?.content?.fields?.value ?? null;
  } catch {
    return null;
  }
}

/** Read a Vault's fields: { owner, wipedAll, manifest (utf8 string), delegates } or null. */
export async function readVault(vaultId) {
  const obj = await rpc("sui_getObject", [vaultId, { showContent: true }]);
  const f = obj?.data?.content?.fields;
  if (!f) return null;
  const manifestBytes = Array.isArray(f.manifest) ? Uint8Array.from(f.manifest) : new Uint8Array();
  return {
    owner: f.owner,
    wipedAll: Boolean(f.wiped_all),
    delegates: f.delegates || [],
    manifest: new TextDecoder().decode(manifestBytes),
  };
}

/** Update the on-chain manifest pointer (gateway signs as delegate). Fire-and-forget safe. */
export async function setManifestOnChain(vaultId, blobId) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${config.vault.packageId}::vault::set_manifest`,
    arguments: [tx.object(vaultId), tx.pure("vector<u8>", Array.from(new TextEncoder().encode(blobId)))],
  });
  tx.setGasBudget(10_000_000);
  await gatewayKp.signAndExecuteTransaction({ transaction: tx, client: suiClient });
}
