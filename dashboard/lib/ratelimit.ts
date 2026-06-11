/**
 * In-memory sliding-window rate limiter. Good for a single always-on instance
 * (local + the Render gateway). For multi-instance serverless, back it with a
 * shared store (e.g. Upstash) — the interface stays the same.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  if (b.count >= limit) return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  b.count++;
  return { ok: true, retryAfter: 0 };
}

// Opportunistic cleanup so the map can't grow unbounded.
let lastSweep = 0;
export function sweep() {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k);
}

/** Best-effort client identifier from proxy headers (falls back to a constant). */
export function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "local";
}
