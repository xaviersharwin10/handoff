/**
 * Text embeddings for the memory index.
 *
 * Default: a FREE local model (all-MiniLM-L6-v2 via transformers.js, 384-dim,
 * no API key, runs on CPU). Optionally provider-agnostic: set EMBED_BASE_URL +
 * EMBED_API_KEY (+ EMBED_MODEL) to use any OpenAI-compatible /embeddings API.
 *
 * All vectors are L2-normalized, so cosine similarity = dot product.
 */
const REMOTE_BASE = (process.env.EMBED_BASE_URL || "").replace(/\/$/, "");
const REMOTE_KEY = process.env.EMBED_API_KEY || "";
const LOCAL_MODEL = process.env.EMBED_MODEL || "Xenova/all-MiniLM-L6-v2";

let localPipe = null;
async function localEmbedder() {
  if (!localPipe) {
    const { pipeline } = await import("@xenova/transformers");
    localPipe = pipeline("feature-extraction", LOCAL_MODEL);
  }
  return localPipe;
}

function normalize(v) {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

/** Embed one text → normalized number[]. */
export async function embed(text) {
  if (REMOTE_BASE && REMOTE_KEY) {
    const r = await fetch(`${REMOTE_BASE}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${REMOTE_KEY}` },
      body: JSON.stringify({ model: process.env.EMBED_MODEL || "text-embedding-3-small", input: text }),
    });
    if (!r.ok) throw new Error(`embeddings API ${r.status}`);
    const j = await r.json();
    return normalize(j.data[0].embedding);
  }
  const ex = await localEmbedder();
  return Array.from((await ex(String(text), { pooling: "mean", normalize: true })).data);
}

/** Cosine similarity of two normalized vectors (= dot product). */
export function cosine(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/** Warm the local model at startup so the first request isn't slow. */
export function warmup() {
  if (!REMOTE_BASE) localEmbedder().catch((e) => console.warn("[embedder] warmup failed:", e?.message));
}
