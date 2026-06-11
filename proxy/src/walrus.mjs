/**
 * Direct Walrus storage via the public testnet publisher/aggregator HTTP API.
 * Blobs are Seal-encrypted before they get here — Walrus only ever sees ciphertext.
 */
import { config } from "./config.mjs";

const retry = async (fn, n = 3) => {
  let e;
  for (let i = 0; i < n; i++) {
    try { return await fn(); } catch (x) { e = x; await new Promise((r) => setTimeout(r, 800 * (i + 1))); }
  }
  throw e;
};

/** Store bytes on Walrus → blobId. */
export async function walrusPut(bytes) {
  return retry(async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60_000);
    try {
      const r = await fetch(`${config.walrus.publisherUrl}/v1/blobs?epochs=${config.walrus.epochs}`, {
        method: "PUT",
        body: bytes,
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(`walrus publisher ${r.status}`);
      const j = await r.json();
      const blobId = j?.newlyCreated?.blobObject?.blobId || j?.alreadyCertified?.blobId;
      if (!blobId) throw new Error("walrus publisher returned no blobId");
      return blobId;
    } finally {
      clearTimeout(t);
    }
  });
}

/** Fetch bytes from Walrus by blobId. */
export async function walrusGet(blobId) {
  return retry(async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const r = await fetch(`${config.walrus.aggregatorUrl}/v1/blobs/${blobId}`, { signal: ctrl.signal });
      if (!r.ok) throw new Error(`walrus aggregator ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    } finally {
      clearTimeout(t);
    }
  });
}
