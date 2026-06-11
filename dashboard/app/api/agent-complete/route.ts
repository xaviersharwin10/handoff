import { NextResponse } from "next/server";
import { readJson, str, strArray } from "@/lib/validate";
import { fail, tooMany } from "@/lib/http";
import { rateLimit, clientKey, sweep } from "@/lib/ratelimit";

export const runtime = "nodejs";

/**
 * The third-party agent's reasoning step. Given ONLY the memory slice the gateway
 * returned (already scoped to the grant) plus the running conversation, it:
 *   1. produces a grounded answer, and
 *   2. extracts 0–2 durable facts/findings from this exchange worth writing BACK
 *      into the granted memory (the client signs those writes with the grant
 *      credential — this route never touches the vault).
 *
 * Provider-agnostic: works with any free OpenAI-compatible endpoint
 *   - Groq      : LLM_BASE_URL=https://api.groq.com/openai/v1            LLM_MODEL=llama-3.3-70b-versatile
 *   - Gemini    : LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai  LLM_MODEL=gemini-2.0-flash
 *   - OpenRouter: LLM_BASE_URL=https://openrouter.ai/api/v1             LLM_MODEL=meta-llama/llama-3.3-70b-instruct:free
 * Falls back to a deterministic answer if no key is set, so the demo always runs.
 */
const BASE_URL = (process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
const MODEL = process.env.LLM_MODEL || "llama-3.3-70b-versatile";

type Turn = { role: "user" | "agent"; text: string };

async function llm(key: string, messages: { role: string; content: string }[], opts: { json?: boolean; maxTokens?: number; temperature?: number } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: opts.maxTokens ?? 400,
        temperature: opts.temperature ?? 0.4,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        messages,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return (data?.choices?.[0]?.message?.content || "").trim();
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: Request) {
  let task = "", agentLabel = "", category = "", mems: string[] = [], history: Turn[] = [], canWrite = false;
  try {
    sweep();
    const rl = rateLimit(`agent:${clientKey(req)}`, 30, 60_000);
    if (!rl.ok) return tooMany(rl.retryAfter);

    const body = await readJson(req);
    task = str(body.task, "task", 1000);
    agentLabel = str(body.agentLabel ?? "Agent", "agentLabel", 80);
    category = str(body.category ?? "memory", "category", 200);
    mems = strArray(body.memories ?? [], "memories", 50, 4000);
    canWrite = body.canWrite === true;
    if (Array.isArray(body.history)) {
      history = body.history
        .filter((t: any) => t && (t.role === "user" || t.role === "agent") && typeof t.text === "string")
        .slice(-8)
        .map((t: any) => ({ role: t.role, text: String(t.text).slice(0, 2000) }));
    }
  } catch (e) {
    return fail(e);
  }

  const key = process.env.LLM_API_KEY;
  if (!key) {
    return NextResponse.json({ answer: fallback(agentLabel, category, mems, task), grounded: mems.length > 0, model: "fallback", learned: [] });
  }

  const system =
    `You are ${agentLabel || "an AI agent"}, a third-party assistant. ` +
    `The user shared a scoped slice of their memory with you (category "${category}"). ` +
    `Some memory items may have been written by other agents or captured from the user's AI chats — treat them as shared working context and build on them. ` +
    `You may ONLY use the memory items provided — you have no other knowledge of the user. ` +
    `Be concise, helpful, and concrete. If the items don't cover what's asked, say what's missing rather than inventing details. ` +
    `Never claim to know anything about the user beyond these items.`;
  const memBlock =
    `Shared memory (category "${category}"):\n` +
    (mems.length ? mems.map((m) => `- ${m}`).join("\n") : "(no relevant items returned)");

  const convo: { role: string; content: string }[] = [{ role: "system", content: system }];
  for (const t of history) convo.push({ role: t.role === "user" ? "user" : "assistant", content: t.text });
  convo.push({ role: "user", content: `${memBlock}\n\nUser's request: ${task}` });

  try {
    const answer = (await llm(key, convo)) || fallback(agentLabel, category, mems, task);

    // Extraction step: what did THIS exchange produce that's worth writing back
    // into the granted memory? (findings, decisions, user facts — durable only)
    let learned: string[] = [];
    if (canWrite) {
      try {
        const exSys =
          `You extract durable items worth saving to long-term shared memory (category "${category}") from one exchange between a user and the agent "${agentLabel}". ` +
          `Keep ONLY things useful in future sessions or to other agents: new facts about the user, decisions made, concrete findings/results the agent produced. ` +
          `Each item must be a short, self-contained, third-person statement. ` +
          `NEVER re-save anything already in the provided existing memory. Drop greetings, questions, and generic advice. ` +
          `Return JSON: {"learned":["...", "..."]}. Empty list if nothing qualifies. Max 2.`;
        const exUser =
          `Existing memory:\n${mems.length ? mems.map((m) => `- ${m}`).join("\n") : "(none)"}\n\n` +
          `Exchange:\nUser: ${task}\n${agentLabel}: ${answer}`;
        const raw = await llm(key, [{ role: "system", content: exSys }, { role: "user", content: exUser }], { json: true, maxTokens: 250, temperature: 0.2 });
        let parsed: any;
        try { parsed = JSON.parse(raw); } catch { parsed = JSON.parse((raw.match(/\{[\s\S]*\}/) || ["{}"])[0]); }
        learned = (parsed?.learned || [])
          .filter((x: unknown) => typeof x === "string" && (x as string).trim())
          .map((x: string) => x.trim().slice(0, 500))
          .slice(0, 2);
      } catch {
        learned = []; // extraction is best-effort; the answer still stands
      }
    }

    return NextResponse.json({ answer, grounded: mems.length > 0, model: MODEL, learned });
  } catch (e: any) {
    return NextResponse.json({ answer: fallback(agentLabel, category, mems, task), grounded: mems.length > 0, model: "fallback", learned: [], note: String(e?.message || e) });
  }
}

function fallback(agentLabel: string, category: string, mems: string[], task: string): string {
  if (mems.length === 0) {
    return `I checked the "${category}" memory you shared with me, but nothing there matches "${task}". Grant me a relevant category or add a memory, and I'll use it.`;
  }
  return (
    `Using the "${category}" memory you shared, here's what I'll act on for “${task}”:\n` +
    mems.map((m) => `• ${m}`).join("\n") +
    `\n\n(That's everything I can see — your other categories stay private.)`
  );
}
