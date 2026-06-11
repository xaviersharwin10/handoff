/**
 * The Handoff memory layer — self-Seal, Walrus-native, no external memory service.
 *
 *   write : embed(text) → Seal-encrypt under the user's Vault (id = memoryId)
 *           → ciphertext to Walrus → entry in the vault's index
 *   recall: embed(query) → cosine over the index (namespace-filtered)
 *           → Walrus fetch → Seal-decrypt as the vault's delegate
 *   shred : on-chain (owner-signed) — here we just drop local state + manifest
 *
 * The index lives in gateway memory and is persisted as a Seal-encrypted
 * MANIFEST blob on Walrus, with its blobId pinned on-chain in the Vault — so
 * the whole system stays database-free and survives restarts. The manifest
 * contains NO plaintext (only vectors + blob pointers): a shredded memory's
 * text is unrecoverable even from old manifest versions.
 */
import { randomBytes } from "node:crypto";
import { embed, cosine } from "./embedder.mjs";
import { walrusPut, walrusGet } from "./walrus.mjs";
import { sealEncrypt, sealDecrypt, evict, vaultForOwner, readVault, setManifestOnChain } from "./sealbox.mjs";
import { config } from "./config.mjs";

// Seal identity for manifest blobs (stable per vault; dies with shred_all).
const MANIFEST_ID = Buffer.from("manifest").toString("hex");

/** vaultId -> { entries: [{memId, ns, vec, blobId, at, src}], loaded, saveTimer } */
const vaults = new Map();
/** memId -> plaintext (RAM only — never persisted; evicted on shred). */
const textCache = new Map();
/** accountId -> { vaultId, owner, at } resolution cache. */
const resolveCache = new Map();

function state(vaultId) {
  let s = vaults.get(vaultId);
  if (!s) {
    s = { entries: [], loadPromise: null, saveTimer: null };
    vaults.set(vaultId, s);
  }
  return s;
}

async function rpc(method, params) {
  const r = await fetch(config.suiRpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await r.json()).result;
}

/** MemWal accountId → { vaultId, owner }. Throws if the user has no vault yet. */
export async function resolveVault(accountId) {
  const hit = resolveCache.get(accountId);
  if (hit && Date.now() - hit.at < 60_000) return hit;
  const acct = await rpc("sui_getObject", [accountId, { showContent: true }]);
  const owner = acct?.data?.content?.fields?.owner;
  if (!owner) throw new Error("account_not_found");
  const vaultId = await vaultForOwner(owner);
  if (!vaultId) throw new Error("vault_not_provisioned");
  const out = { vaultId, owner, at: Date.now() };
  resolveCache.set(accountId, out);
  return out;
}

/** Load the index from the on-chain manifest pointer (idempotent; concurrent
 *  callers share one load — a boolean flag here would race and return an empty
 *  index to the second caller). */
export async function ensureLoaded(vaultId) {
  const s = state(vaultId);
  if (!s.loadPromise) {
    s.loadPromise = (async () => {
      try {
        const v = await readVault(vaultId);
        if (v?.wipedAll) {
          s.entries = [];
          return;
        }
        if (v?.manifest) {
          const ct = await walrusGet(v.manifest);
          const json = new TextDecoder().decode(await sealDecrypt(vaultId, MANIFEST_ID, ct));
          const data = JSON.parse(json);
          s.entries = (data.entries || []).filter((e) => e && e.memId && e.blobId && Array.isArray(e.vec));
          console.log(`[memory] loaded ${s.entries.length} entries for vault ${vaultId.slice(0, 10)}…`);
        }
      } catch (e) {
        // an empty index is valid for a fresh vault; otherwise log and serve empty
        console.warn(`[memory] manifest load failed for ${vaultId.slice(0, 10)}…: ${String(e?.message || e).slice(0, 90)}`);
      }
    })();
  }
  await s.loadPromise;
  return s;
}

/** Persist the index: encrypted manifest → Walrus → on-chain pointer (debounced). */
function scheduleSave(vaultId) {
  const s = state(vaultId);
  if (s.saveTimer) clearTimeout(s.saveTimer);
  s.saveTimer = setTimeout(async () => {
    s.saveTimer = null;
    try {
      const payload = JSON.stringify({
        v: 1,
        entries: s.entries.map((e) => ({ ...e, vec: e.vec.map((x) => +x.toFixed(5)) })),
      });
      const ct = await sealEncrypt(MANIFEST_ID, new TextEncoder().encode(payload));
      const blobId = await walrusPut(ct);
      await setManifestOnChain(vaultId, blobId);
      console.log(`[memory] manifest saved for ${vaultId.slice(0, 10)}… (${s.entries.length} entries → ${blobId.slice(0, 10)}…)`);
    } catch (e) {
      console.warn(`[memory] manifest save failed: ${String(e?.message || e).slice(0, 90)}`);
    }
  }, 8_000);
}

/** Store one memory. `src` records WHO wrote it (e.g. "capture", an agent's
 *  grant label, or "you" for a manual owner write) — provenance for the UI.
 *  Returns { memId, blobId, namespace }. */
export async function write(vaultId, namespace, text, { src = "you" } = {}) {
  const s = await ensureLoaded(vaultId);
  const memId = randomBytes(16).toString("hex");
  const vec = await embed(text);
  const ct = await sealEncrypt(memId, new TextEncoder().encode(text));
  const blobId = await walrusPut(ct);
  s.entries.push({ memId, ns: namespace, vec, blobId, at: Date.now(), src: String(src).slice(0, 80) });
  textCache.set(memId, text);
  scheduleSave(vaultId);
  return { memId, blobId, namespace };
}

/** Decrypt one entry's text (RAM cache → Walrus + Seal). Throws if shredded. */
async function hydrate(vaultId, entry) {
  const cached = textCache.get(entry.memId);
  if (cached !== undefined) return cached;
  const ct = await walrusGet(entry.blobId);
  const text = new TextDecoder().decode(await sealDecrypt(vaultId, entry.memId, ct));
  textCache.set(entry.memId, text);
  return text;
}

/**
 * Semantic recall over the vault (optionally one namespace).
 * Entries whose decryption is denied on-chain (shredded elsewhere) are dropped
 * from the index on the spot — the policy is the source of truth.
 */
export async function recall(vaultId, query, { namespace, limit = 5, minScore = 0.25 } = {}) {
  const s = await ensureLoaded(vaultId);
  const qv = await embed(query);
  const ranked = s.entries
    .filter((e) => !namespace || e.ns === namespace)
    .map((e) => ({ e, score: cosine(qv, e.vec) }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(limit, 20));

  const out = [];
  for (const { e, score } of ranked) {
    try {
      out.push({ memId: e.memId, namespace: e.ns, text: await hydrate(vaultId, e), score: +score.toFixed(3), at: e.at, src: e.src });
    } catch {
      dropEntry(vaultId, e.memId); // denied on-chain → treat as shredded
    }
  }
  return out;
}

/** List recent memories (hydrated), newest first. */
export async function list(vaultId, { namespace, limit = 20 } = {}) {
  const s = await ensureLoaded(vaultId);
  const rows = s.entries
    .filter((e) => !namespace || e.ns === namespace)
    .sort((a, b) => b.at - a.at)
    .slice(0, Math.min(limit, 50));
  const out = [];
  for (const e of rows) {
    try {
      out.push({ memId: e.memId, namespace: e.ns, text: await hydrate(vaultId, e), at: e.at, src: e.src });
    } catch {
      dropEntry(vaultId, e.memId);
    }
  }
  return out;
}

function dropEntry(vaultId, memId) {
  const s = state(vaultId);
  const before = s.entries.length;
  s.entries = s.entries.filter((e) => e.memId !== memId);
  textCache.delete(memId);
  evict(memId);
  if (s.entries.length !== before) scheduleSave(vaultId);
}

/** Owner shredded a memory on-chain — drop all local state for it. */
export function onShredded(vaultId, memId) {
  dropEntry(vaultId, memId);
}

/** Owner wiped the vault on-chain — drop everything local. */
export function onWipedAll(vaultId) {
  const s = state(vaultId);
  for (const e of s.entries) {
    textCache.delete(e.memId);
    evict(e.memId);
  }
  s.entries = [];
  evict(); // clear all decrypt clients (manifest id included)
  if (s.saveTimer) clearTimeout(s.saveTimer);
  s.saveTimer = null; // do NOT save a manifest for a wiped vault
}

/** Namespaces currently present in a vault's index (for UI). */
export async function namespaces(vaultId) {
  const s = await ensureLoaded(vaultId);
  const counts = {};
  for (const e of s.entries) counts[e.ns] = (counts[e.ns] || 0) + 1;
  return counts;
}
