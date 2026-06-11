/**
 * Handoff proxy — the enforcement gateway.
 *
 * A third-party agent calls POST /recall with a grant id, a query, a timestamp,
 * and a signature made with the grant credential. The proxy:
 *   1. checks the request is fresh (anti-replay)
 *   2. reads the on-chain Grant (truth: scope, expiry, revoked)
 *   3. verifies the caller holds the grant credential
 *   4. recalls MemWal scoped to ONLY the grant's namespace
 *   5. logs the access (allowed or denied)
 *
 * The grantee can never widen scope, outlive the expiry, or survive a revoke —
 * all enforced from chain, not from anything the caller sends.
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "./config.mjs";
import { fetchGrant, checkGrantValidity, verifyCredential, fetchAccountOwner } from "./grant.mjs";
import { logAccessOnChain } from "./audit.mjs";
import { assertOwnerAuth } from "./owner-auth.mjs";
import * as memory from "./vault-memory.mjs";
import { vaultForOwner } from "./sealbox.mjs";
import { warmup as warmEmbedder } from "./embedder.mjs";
import {
  verifyCaptureToken,
  forwardChat,
  forwardChatStream,
  extractAndStore,
  buildTranscript,
} from "./capture.mjs";

const app = new Hono();
// Scope CORS to the owner/agent app origin(s). Set GATEWAY_ALLOWED_ORIGINS in prod.
const allowedOrigins = (process.env.GATEWAY_ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use("*", cors({ origin: allowedOrigins, allowMethods: ["GET", "POST", "OPTIONS"] }));

/** Simple in-memory per-IP rate limiter (single always-on instance). */
const rlBuckets = new Map();
function rateLimited(key, limit, windowMs) {
  const now = Date.now();
  const b = rlBuckets.get(key);
  if (!b || now >= b.resetAt) {
    rlBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  if (b.count >= limit) return true;
  b.count++;
  return false;
}
function clientIp(c) {
  const xff = c.req.header("x-forwarded-for");
  return (xff ? xff.split(",")[0].trim() : c.req.header("x-real-ip")) || "local";
}

/** Retry transient relayer failures (staging relayer occasionally times out). */
async function withRetry(fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

/** In-memory log for instant local feedback; the durable, verifiable log lives
 *  on-chain (AccessLogged events) and is what the dashboard reads in production. */
const accessLog = [];
function logAccess(entry) {
  accessLog.unshift({ at: new Date().toISOString(), ...entry });
  if (accessLog.length > 500) accessLog.pop();
  logAccessOnChain(entry); // fire-and-forget; skips spam/garbage internally
}

app.get("/health", (c) => c.json({ ok: true, service: "handoff-proxy" }));

app.get("/access-log", (c) => {
  const grantId = c.req.query("grantId");
  const account = c.req.query("account");
  let rows = accessLog;
  if (grantId) rows = rows.filter((r) => r.grantId === grantId);
  if (account) rows = rows.filter((r) => r.memwalAccount === account);
  return c.json({ total: rows.length, entries: rows.slice(0, 100) });
});

/**
 * Shared grant authorization for /recall and /remember. Verifies freshness, the
 * on-chain grant (scope/expiry/revoked), that the grantor owns the account, and
 * the credential signature over `payload`. Returns { grant, vaultId } on success
 * or { res } with the deny response already logged (allow + deny both audited).
 */
async function authorizeGrant(c, op, { grantId, payload, timestamp, signature }) {
  const deny = (status, reason, extra = {}) => {
    logAccess({ grantId, op, query: payload, allowed: false, reason, ...extra });
    return { res: c.json({ allowed: false, reason }, status) };
  };

  // 1. freshness
  const age = Date.now() - Number(timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > config.maxRequestAgeMs) {
    return deny(401, "stale_request");
  }

  // 2. on-chain grant truth
  const grant = await fetchGrant(config.suiRpcUrl, config.handoffPackageId, grantId);
  const validity = checkGrantValidity(grant);
  if (!validity.ok) return deny(403, validity.reason, { granteeLabel: grant?.granteeLabel, namespace: grant?.namespace, memwalAccount: grant?.memwalAccount });

  // 2b. authorization: the grantor MUST own the account the grant scopes.
  //     create_grant doesn't bind these on-chain, so without this a third party
  //     could mint a grant over someone else's vault. The gateway is the only
  //     path to memory, so we enforce it here (and record the denial on-chain).
  const owner = await fetchAccountOwner(config.suiRpcUrl, grant.memwalAccount);
  if (!owner || owner !== grant.grantor) {
    return deny(403, "grantor_not_account_owner", { granteeLabel: grant.granteeLabel, namespace: grant.namespace, memwalAccount: grant.memwalAccount });
  }

  // 3. credential proof (op-bound: a recall signature can't authorize a write)
  const okSig = await verifyCredential(grant, payload, timestamp, signature, op);
  if (!okSig) return deny(401, "bad_signature", { granteeLabel: grant.granteeLabel, namespace: grant.namespace, memwalAccount: grant.memwalAccount });

  const vaultId = await vaultForOwner(owner);
  if (!vaultId) return deny(403, "vault_not_provisioned", { granteeLabel: grant.granteeLabel, namespace: grant.namespace, memwalAccount: grant.memwalAccount });

  return { grant, vaultId, deny };
}

function parseGrantBody(c, body, payloadField, maxLen) {
  const { grantId, timestamp, signature } = body ?? {};
  const payload = body?.[payloadField];
  if (!grantId || !payload || !timestamp || !signature) {
    return { err: c.json({ error: "missing_fields", need: ["grantId", payloadField, "timestamp", "signature"] }, 400) };
  }
  if (
    typeof grantId !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(grantId) ||
    typeof payload !== "string" || payload.length > maxLen ||
    typeof signature !== "string" || signature.length > 4000 ||
    !Number.isFinite(Number(timestamp))
  ) {
    return { err: c.json({ error: "bad_request" }, 400) };
  }
  return { grantId, payload, timestamp, signature };
}

app.post("/recall", async (c) => {
  if (rateLimited(`recall:${clientIp(c)}`, 60, 60_000)) {
    return c.json({ error: "rate_limited" }, 429);
  }
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const parsed = parseGrantBody(c, body, "query", 1000);
  if (parsed.err) return parsed.err;
  const { grantId, payload: query, timestamp, signature } = parsed;

  const auth = await authorizeGrant(c, "recall", { grantId, payload: query, timestamp, signature });
  if (auth.res) return auth.res;
  const { grant, vaultId, deny } = auth;

  // scoped recall — pinned to the grant's namespace; the caller cannot widen
  // it. Self-Seal pipeline: cosine over the vault's own index, then each hit
  // is Seal-decrypted under the vault policy (shredded memories stay dead).
  let results;
  try {
    const hits = await withRetry(() =>
      memory.recall(vaultId, query, { namespace: grant.namespace, limit: Math.min(Number(body.limit) || 5, 20) }),
    );
    results = hits.map((h) => ({ text: h.text, distance: +(1 - h.score).toFixed(3), src: h.src, at: h.at }));
  } catch (e) {
    return deny(502, "recall_failed", { granteeLabel: grant.granteeLabel, namespace: grant.namespace, detail: String(e?.message || e) }).res;
  }

  logAccess({
    grantId,
    op: "recall",
    granteeLabel: grant.granteeLabel,
    namespace: grant.namespace,
    memwalAccount: grant.memwalAccount,
    query,
    allowed: true,
    resultCount: results.length,
  });
  return c.json({ allowed: true, namespace: grant.namespace, granteeLabel: grant.granteeLabel, results });
});

// Grant write-back: an agent holding a valid grant credential can WRITE a memory
// into the ONE namespace it was granted — so agents remember and build over time.
// Same on-chain enforcement as /recall (expiry, revocation, grantor-owns-account),
// the write is provenance-tagged with the agent's label, and — like everything in
// the vault — the owner can later shred it with on-chain proof.
app.post("/remember", async (c) => {
  if (rateLimited(`remember:${clientIp(c)}`, 30, 60_000)) {
    return c.json({ error: "rate_limited" }, 429);
  }
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const parsed = parseGrantBody(c, body, "text", 2000);
  if (parsed.err) return parsed.err;
  const { grantId, payload: text, timestamp, signature } = parsed;

  const auth = await authorizeGrant(c, "remember", { grantId, payload: text, timestamp, signature });
  if (auth.res) return auth.res;
  const { grant, vaultId, deny } = auth;

  let stored;
  try {
    stored = await withRetry(() => memory.write(vaultId, grant.namespace, text.trim(), { src: grant.granteeLabel }));
  } catch (e) {
    return deny(502, "store_failed", { granteeLabel: grant.granteeLabel, namespace: grant.namespace, detail: String(e?.message || e) }).res;
  }

  logAccess({
    grantId,
    op: "remember",
    granteeLabel: grant.granteeLabel,
    namespace: grant.namespace,
    memwalAccount: grant.memwalAccount,
    query: text.slice(0, 200),
    allowed: true,
    // the deployed AccessLogged event has no op field; carry the write marker in
    // `reason` so the activity feed can tell writes from reads
    reason: "remember",
    resultCount: 1,
  });
  return c.json({ allowed: true, namespace: grant.namespace, granteeLabel: grant.granteeLabel, memId: stored.memId });
});

// ----------------------------------------------------------------- owner memory API
// Device-key signed (same on-chain delegate verification as the dashboard):
// the browser signs `handoff-mem|account|<op>|<ts>`; we verify against the
// account's registered delegate pubkeys, then operate on the user's vault.

async function ownerCtx(c, op, { rate = 30 } = {}) {
  if (rateLimited(`mem:${op}:${clientIp(c)}`, rate, 60_000)) {
    return { err: c.json({ error: "rate_limited" }, 429) };
  }
  let body;
  try {
    body = await c.req.json();
  } catch {
    return { err: c.json({ error: "invalid_json" }, 400) };
  }
  const { accountId, ts, sig } = body ?? {};
  if (typeof accountId !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(accountId) || !Number.isFinite(Number(ts)) || typeof sig !== "string") {
    return { err: c.json({ error: "bad_request" }, 400) };
  }
  try {
    await assertOwnerAuth(accountId, op, Number(ts), sig);
  } catch (e) {
    return { err: c.json({ error: String(e?.message || "unauthorized") }, 401) };
  }
  try {
    const { vaultId } = await memory.resolveVault(accountId);
    return { body, vaultId };
  } catch (e) {
    return { err: c.json({ error: String(e?.message || "vault_error") }, 409) };
  }
}

app.post("/memory", async (c) => {
  const { err, body, vaultId } = await ownerCtx(c, "remember");
  if (err) return err;
  const ns = String(body.namespace || "").trim().slice(0, 64);
  const text = String(body.text || "").trim().slice(0, 4000);
  if (!ns || !text) return c.json({ error: "namespace and text required" }, 400);
  try {
    const r = await withRetry(() => memory.write(vaultId, ns, text));
    return c.json({ ok: true, memId: r.memId, blobId: r.blobId, namespace: r.namespace });
  } catch (e) {
    return c.json({ error: "store_failed", detail: String(e?.message || e).slice(0, 120) }, 502);
  }
});

app.post("/memory/recall", async (c) => {
  const { err, body, vaultId } = await ownerCtx(c, "recall", { rate: 60 });
  if (err) return err;
  const query = String(body.query || "").trim().slice(0, 1000);
  if (!query) return c.json({ error: "query required" }, 400);
  const namespace = body.namespace ? String(body.namespace).slice(0, 64) : undefined;
  try {
    const hits = await withRetry(() => memory.recall(vaultId, query, { namespace, limit: Math.min(Number(body.limit) || 5, 20) }));
    return c.json({ results: hits });
  } catch (e) {
    return c.json({ error: "recall_failed", detail: String(e?.message || e).slice(0, 120) }, 502);
  }
});

app.post("/memory/list", async (c) => {
  const { err, body, vaultId } = await ownerCtx(c, "list", { rate: 60 });
  if (err) return err;
  const namespace = body.namespace ? String(body.namespace).slice(0, 64) : undefined;
  try {
    const [rows, counts] = await Promise.all([
      memory.list(vaultId, { namespace, limit: Math.min(Number(body.limit) || 20, 50) }),
      memory.namespaces(vaultId),
    ]);
    return c.json({ memories: rows, namespaces: counts, vaultId });
  } catch (e) {
    return c.json({ error: "list_failed", detail: String(e?.message || e).slice(0, 120) }, 502);
  }
});

// Owner shredded on-chain (sponsored tx from the dashboard) — sync local state.
app.post("/memory/shredded", async (c) => {
  const { err, body, vaultId } = await ownerCtx(c, "shredded");
  if (err) return err;
  if (body.all === true) {
    memory.onWipedAll(vaultId);
    return c.json({ ok: true, wiped: true });
  }
  const memId = String(body.memId || "");
  if (!/^[0-9a-f]{32}$/.test(memId)) return c.json({ error: "memId required (32 hex chars)" }, 400);
  memory.onShredded(vaultId, memId);
  return c.json({ ok: true, memId });
});

// ----------------------------------------------------------------- capture proxy
// Passive memory capture for any OpenAI-compatible AI tool. Point the tool's base
// URL at <gateway>/capture/v1 and use a Handoff capture token as the API key.

function captureAuth(c) {
  const bearer = (c.req.header("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const token = bearer || c.req.header("x-handoff-token") || "";
  return verifyCaptureToken(token);
}

// Some clients probe /models on connect.
app.get("/capture/v1/models", (c) =>
  c.json({ object: "list", data: [{ id: "handoff-capture", object: "model", owned_by: "handoff" }] }),
);

app.post("/capture/v1/chat/completions", async (c) => {
  if (rateLimited(`capture:${clientIp(c)}`, 120, 60_000)) {
    return c.json({ error: { message: "rate_limited", type: "rate_limit" } }, 429);
  }
  const accountId = captureAuth(c);
  if (!accountId) {
    return c.json({ error: { message: "invalid Handoff capture token", type: "invalid_request_error" } }, 401);
  }
  if (!config.llm.apiKey) {
    return c.json({ error: { message: "gateway has no upstream LLM configured", type: "server_error" } }, 502);
  }
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { message: "invalid JSON", type: "invalid_request_error" } }, 400);
  }
  if (!Array.isArray(body?.messages)) {
    return c.json({ error: { message: "messages[] required", type: "invalid_request_error" } }, 400);
  }

  try {
    if (body.stream) {
      return await forwardChatStream(accountId, body);
    }
    const data = await forwardChat(body);
    const reply = data?.choices?.[0]?.message?.content || "";
    extractAndStore(accountId, buildTranscript(body.messages, reply)); // fire-and-forget
    return c.json(data);
  } catch (e) {
    return c.json({ error: { message: String(e?.message || e), type: "upstream_error" } }, 502);
  }
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`• handoff-gateway listening on http://localhost:${info.port}`);
  console.log(`  audit key: ${config.proxyDelegateAddress} (signs on-chain AccessLogged events)`);
  console.log(`  memory: self-Seal (vault pkg ${config.vault.packageId.slice(0, 10)}…) · Walrus ${config.walrus.publisherUrl}`);
  console.log(`  capture: POST /capture/v1/chat/completions · upstream ${config.llm.baseUrl} (${config.llm.model})${config.llm.apiKey ? "" : " — NO LLM KEY"}`);
  warmEmbedder();
});

