/**
 * Capture proxy — passive memory capture for any OpenAI-compatible AI tool.
 *
 * The user points their tool's base URL at  <gateway>/capture/v1  with a capture
 * token as the API key. Every chat completion is forwarded to a real LLM
 * (Groq by default) and returned transparently, while — asynchronously — the
 * exchange is distilled into durable facts, auto-classified into a namespace,
 * and written into the user's own MemWal vault. They never type a memory by hand.
 *
 * The capture token is stateless (no DB): hoc_<b64url(accountId)>_<hmac tag>,
 * where the tag = HMAC-SHA256(master, "capture:"+accountId). The same master that
 * derives each account's memory key verifies the token, so a valid token both
 * proves "may write to this account" and names which account.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.mjs";
import { resolveVault, write } from "./vault-memory.mjs";

const MASTER = process.env.HANDOFF_MASTER_SECRET;
if (!MASTER) throw new Error("HANDOFF_MASTER_SECRET is not set (proxy/.env)");
const masterBytes = Buffer.from(MASTER, "hex");

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const fromB64url = (s) => Buffer.from(s, "base64url").toString("utf8");

/** Categories the auto-classifier may use. Grants are issued against these. */
export const NAMESPACES = [
  "shopping", "travel", "health", "finance", "work",
  "food", "entertainment", "personal", "preferences",
];

function captureTag(accountId) {
  return createHmac("sha256", masterBytes).update("capture:" + accountId.toLowerCase()).digest("hex").slice(0, 32);
}

/** Mint a capture token for an account (called by the dashboard, server-side). */
export function mintCaptureToken(accountId) {
  return `hoc_${b64url(accountId)}_${captureTag(accountId)}`;
}

/** Verify a capture token → accountId, or null if invalid. Constant-time. */
export function verifyCaptureToken(token) {
  if (typeof token !== "string") return null;
  const m = /^hoc_([A-Za-z0-9_-]+)_([0-9a-f]{32})$/.exec(token.trim());
  if (!m) return null;
  let accountId;
  try { accountId = fromB64url(m[1]); } catch { return null; }
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(accountId)) return null;
  const expected = Buffer.from(captureTag(accountId), "hex");
  const got = Buffer.from(m[2], "hex");
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  return accountId;
}

// ----------------------------------------------------------------- LLM helper

async function llm(messages, { json = false, maxTokens = 600, temperature = 0.4 } = {}) {
  if (!config.llm.apiKey) throw new Error("no LLM_API_KEY configured on the gateway");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.llm.apiKey}` },
      body: JSON.stringify({
        model: config.llm.model,
        max_tokens: maxTokens,
        temperature,
        ...(json ? { response_format: { type: "json_object" } } : {}),
        messages,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`upstream ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------- extraction + storage

/**
 * Distill an exchange into 0–3 durable, third-person facts + a namespace each,
 * then write them into the user's Seal-encrypted vault (self-Seal pipeline:
 * embed → Seal-encrypt → Walrus → own index). Fire-and-forget; never throws.
 * Returns the stored items (for tests / the live capture feed).
 */
export async function extractAndStore(accountId, transcript) {
  try {
    const sys =
      `You extract DURABLE, reusable facts about the user from a snippet of their AI chat, for long-term memory. ` +
      `Only keep things still true weeks later: stable preferences, plans, owned items, constraints, profile facts, decisions. ` +
      `Drop greetings, one-off questions, the assistant's generic advice, and anything ephemeral. ` +
      `Write each fact as a short third-person statement ("The user ..."). ` +
      `Classify each into exactly one namespace from: ${NAMESPACES.join(", ")}. ` +
      `Return JSON: {"memories":[{"namespace":"<one>","text":"<fact>"}]}. ` +
      `If nothing is worth remembering, return {"memories":[]}. Max 3.`;
    const data = await llm(
      [{ role: "system", content: sys }, { role: "user", content: transcript.slice(0, 6000) }],
      { json: true, maxTokens: 500, temperature: 0.2 },
    );
    const raw = data?.choices?.[0]?.message?.content || "{}";
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = JSON.parse((raw.match(/\{[\s\S]*\}/) || ["{}"])[0]); }
    const items = (parsed?.memories || [])
      .filter((m) => m && typeof m.text === "string" && m.text.trim())
      .map((m) => ({ namespace: NAMESPACES.includes(m.namespace) ? m.namespace : "personal", text: m.text.trim().slice(0, 500) }))
      .slice(0, 3);
    if (items.length === 0) return [];

    const { vaultId } = await resolveVault(accountId);
    for (const it of items) {
      await write(vaultId, it.namespace, it.text, { src: "capture" });
    }
    console.log(`[capture] stored ${items.length} mem(${accountId.slice(0, 10)}…):`, items.map((i) => `${i.namespace}:${i.text.slice(0, 40)}`).join(" | "));
    return items;
  } catch (e) {
    console.warn("[capture] extract/store failed:", String(e?.message || e));
    return [];
  }
}

/** Build a compact transcript (last user turn + assistant reply, with a little prior context). */
export function buildTranscript(messages, assistantReply) {
  const recent = (Array.isArray(messages) ? messages : []).slice(-6)
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`);
  if (assistantReply) recent.push(`Assistant: ${assistantReply}`);
  return recent.join("\n");
}

// ------------------------------------------------------------- chat forwarding

/** Forward a NON-streaming chat completion upstream; returns the upstream JSON. */
export async function forwardChat(body) {
  const data = await llm(body.messages || [], {
    maxTokens: Math.min(Number(body.max_tokens) || 800, 2000),
    temperature: typeof body.temperature === "number" ? body.temperature : 0.7,
  });
  return data;
}

/**
 * Forward a STREAMING chat completion upstream and tee it: bytes pass straight
 * through to the caller while assistant content is accumulated so we can capture
 * memory once the stream ends. Returns a web Response (SSE).
 */
export async function forwardChatStream(accountId, body) {
  const ctrl = new AbortController();
  const upstream = await fetch(`${config.llm.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.llm.apiKey}` },
    body: JSON.stringify({
      model: config.llm.model,
      stream: true,
      max_tokens: Math.min(Number(body.max_tokens) || 800, 2000),
      temperature: typeof body.temperature === "number" ? body.temperature : 0.7,
      messages: body.messages || [],
    }),
    signal: ctrl.signal,
  });
  if (!upstream.ok || !upstream.body) {
    const detail = upstream.body ? (await upstream.text()).slice(0, 200) : "no body";
    throw new Error(`upstream stream ${upstream.status}: ${detail}`);
  }

  const decoder = new TextDecoder();
  let assistant = "";
  let buf = "";
  const transform = new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk); // pass through untouched
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          const delta = j?.choices?.[0]?.delta?.content;
          if (typeof delta === "string") assistant += delta;
        } catch { /* partial json across chunks — ignore */ }
      }
    },
    flush() {
      // fire-and-forget capture once the response is complete
      extractAndStore(accountId, buildTranscript(body.messages, assistant));
    },
  });

  return new Response(upstream.body.pipeThrough(transform), {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
