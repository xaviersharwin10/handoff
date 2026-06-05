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
import { MemWal } from "@mysten-incubation/memwal";
import { config } from "./config.mjs";
import { fetchGrant, checkGrantValidity, verifyCredential } from "./grant.mjs";

const app = new Hono();
app.use("*", cors());

/** In-memory access log (newest first). Good enough for the demo + dashboard. */
const accessLog = [];
function logAccess(entry) {
  accessLog.unshift({ at: new Date().toISOString(), ...entry });
  if (accessLog.length > 500) accessLog.pop();
}

app.get("/health", (c) => c.json({ ok: true, service: "handoff-proxy" }));

app.get("/access-log", (c) => {
  const grantId = c.req.query("grantId");
  const rows = grantId ? accessLog.filter((r) => r.grantId === grantId) : accessLog;
  return c.json({ total: rows.length, entries: rows.slice(0, 100) });
});

app.post("/recall", async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const { grantId, query, timestamp, signature, limit } = body ?? {};
  if (!grantId || !query || !timestamp || !signature) {
    return c.json({ error: "missing_fields", need: ["grantId", "query", "timestamp", "signature"] }, 400);
  }

  const deny = (status, reason, extra = {}) => {
    logAccess({ grantId, query, allowed: false, reason, ...extra });
    return c.json({ allowed: false, reason }, status);
  };

  // 1. freshness
  const age = Date.now() - Number(timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > config.maxRequestAgeMs) {
    return deny(401, "stale_request");
  }

  // 2. on-chain grant truth
  const grant = await fetchGrant(config.suiRpcUrl, config.handoffPackageId, grantId);
  const validity = checkGrantValidity(grant);
  if (!validity.ok) return deny(403, validity.reason, { granteeLabel: grant?.granteeLabel, namespace: grant?.namespace });

  // proxy only holds the delegate key for its configured account
  if (grant.memwalAccount !== config.memwalAccount) {
    return deny(403, "account_not_served", { granteeLabel: grant.granteeLabel });
  }

  // 3. credential proof
  const okSig = await verifyCredential(grant, query, timestamp, signature);
  if (!okSig) return deny(401, "bad_signature", { granteeLabel: grant.granteeLabel, namespace: grant.namespace });

  // 4. scoped recall — pinned to the grant's namespace; the caller cannot widen it
  const memwal = MemWal.create({
    key: config.delegateKey,
    accountId: grant.memwalAccount,
    serverUrl: config.relayerUrl,
    namespace: grant.namespace,
  });
  let results;
  try {
    const r = await memwal.recall({ query, limit: Math.min(Number(limit) || 5, 20), maxDistance: 0.65 });
    const seen = new Set();
    results = r.results
      .filter((m) => (seen.has(m.text) ? false : seen.add(m.text)))
      .map((m) => ({ text: m.text, distance: m.distance }));
  } catch (e) {
    return deny(502, "recall_failed", { granteeLabel: grant.granteeLabel, namespace: grant.namespace, detail: String(e?.message || e) });
  }

  // 5. log + return (scoped to the granted slice only)
  logAccess({
    grantId,
    granteeLabel: grant.granteeLabel,
    namespace: grant.namespace,
    query,
    allowed: true,
    resultCount: results.length,
  });
  return c.json({ allowed: true, namespace: grant.namespace, granteeLabel: grant.granteeLabel, results });
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`• handoff-proxy listening on http://localhost:${info.port}`);
  console.log(`  account: ${config.memwalAccount}`);
  console.log(`  relayer: ${config.relayerUrl}`);
});
