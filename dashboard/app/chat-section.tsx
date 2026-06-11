"use client";

/**
 * Built-in chat — the zero-setup way to use Handoff. No external tool, no keys:
 * you're already signed in, so the browser mints this account's capture token
 * and streams the chat through the gateway's capture proxy. The reply streams
 * back like any chatbot while the gateway distils durable facts into the vault.
 */
import { useEffect, useRef, useState } from "react";
import { useHandoff } from "./handoff-context";
import { useToast } from "./toast";
import { getCaptureToken } from "@/lib/capture-client";
import { GATEWAY_URL } from "@/lib/config";
import { MemoryIcon } from "./icons";

type ChatMsg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "I'm vegan, training for the Chennai marathon in December",
  "Help me plan next week — I work Mon–Fri and pick up my daughter at 5",
  "I'm comparing the iPhone 17 and the Pixel 11 — under ₹80k",
];

export function ChatSection() {
  const { address, accountId, status } = useHandoff();
  const toast = useToast();
  const [token, setToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [captured, setCaptured] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Mint the capture token once the vault is ready (device-key signed, no DB).
  useEffect(() => {
    if (status !== "ready" || !address || !accountId || token) return;
    getCaptureToken(address, accountId).then(setToken).catch(() => {/* retried on send */});
  }, [status, address, accountId, token]);

  async function send(text?: string) {
    const t = (text ?? input).trim();
    if (!t || busy || !address || !accountId) return;
    setInput("");
    setBusy(true);
    const history = [...messages, { role: "user" as const, content: t }];
    setMessages([...history, { role: "assistant", content: "" }]);
    try {
      const tok = token ?? (await getCaptureToken(address, accountId).then((x) => { setToken(x); return x; }));
      const res = await fetch(`${GATEWAY_URL}/capture/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
        body: JSON.stringify({ messages: history.slice(-12), stream: true }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error?.message || `gateway ${res.status}`);
      }
      // read the SSE stream and grow the last assistant bubble token by token
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
            if (typeof delta === "string") {
              acc += delta;
              setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: acc }]);
            }
          } catch { /* partial json across chunks */ }
        }
      }
      // the gateway distils facts right after the stream ends — nudge the
      // memory panel to refresh so captured facts appear within seconds
      setCaptured(true);
      setTimeout(() => window.dispatchEvent(new Event("handoff:memory-maybe-changed")), 4500);
      setTimeout(() => window.dispatchEvent(new Event("handoff:memory-maybe-changed")), 9000);
    } catch (e: any) {
      setMessages((m) => [...m.slice(0, -1)]);
      toast.push("error", String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-emerald-900/50 bg-gradient-to-b from-emerald-950/20 to-neutral-900/30 p-5">
      <div className="mb-3 flex items-start gap-3">
        <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-400"><MemoryIcon className="h-5 w-5" /></div>
        <div>
          <h2 className="text-base font-semibold text-neutral-100">
            Chat — and watch your memory build itself
            <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">zero setup</span>
          </h2>
          <p className="text-sm text-neutral-500">
            Talk like you would to any AI. Durable facts are encrypted into <span className="text-emerald-300">your vault</span> as
            you go — nothing to install, no keys, no settings.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-3">
        {messages.length === 0 ? (
          <div className="grid min-h-[7rem] place-items-center text-center">
            <div>
              <p className="text-sm text-neutral-500">Try something with real facts in it:</p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-400 hover:border-emerald-500 hover:text-emerald-300" onClick={() => send(s)} disabled={busy}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid max-h-80 gap-2 overflow-y-auto pr-1">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${m.role === "user" ? "rounded-br-sm bg-neutral-800 text-neutral-100" : "rounded-bl-sm border border-neutral-800 bg-neutral-950 text-neutral-200"}`}>
                  {m.content || <span className="text-neutral-600">…</span>}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="mt-2 flex gap-2">
        <input
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-emerald-500 disabled:opacity-60"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Say something about yourself, your plans, your preferences…"
          disabled={busy}
        />
        <button
          className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
          onClick={() => send()}
          disabled={busy}
        >
          {busy ? "…" : "Send"}
        </button>
      </div>
      {captured && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-400/90">
          ✦ Durable facts from this chat are being encrypted into your vault — they&apos;ll appear in <span className="font-medium">Your memory</span> below in a few seconds.
        </p>
      )}
    </section>
  );
}
