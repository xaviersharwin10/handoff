"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useToast } from "../toast";
import {
  readGrantTerms,
  agentRecall,
  agentRemember,
  type GrantTerms,
  type Credential,
  type RecalledMemory,
} from "@/lib/agent-client";

const short = (s: string) => (s?.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);
function expiresIn(ms: number): string {
  const d = ms - Date.now();
  if (d <= 0) return "expired";
  const m = Math.floor(d / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `in ${h}h` : `in ${Math.floor(h / 24)}d`;
}

type Msg =
  | { role: "user"; text: string }
  | { role: "agent"; text: string; memories?: RecalledMemory[]; saved?: string[]; denied?: string; model?: string };

export default function AgentApp() {
  const toast = useToast();
  const [raw, setRaw] = useState("");
  const [credential, setCredential] = useState<Credential | null>(null);
  const [terms, setTerms] = useState<GrantTerms | null>(null);
  const [loading, setLoading] = useState(false);

  // pick up a credential handed over from the dashboard reveal card
  useEffect(() => {
    const stashed = localStorage.getItem("handoff:agentCred");
    if (stashed) {
      setRaw(stashed);
      localStorage.removeItem("handoff:agentCred");
      void connect(stashed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = useCallback(async (input?: string) => {
    const src = (input ?? raw).trim();
    if (!src) return;
    let cred: Credential;
    try {
      const j = JSON.parse(src);
      if (!j.grantId || !j.credentialPrivateKey) throw new Error("missing fields");
      cred = { grantId: j.grantId, credentialPrivateKey: j.credentialPrivateKey };
    } catch {
      toast.push("error", "Paste the credential JSON the user shared (grantId + credentialPrivateKey).");
      return;
    }
    setLoading(true);
    try {
      const t = await readGrantTerms(cred.grantId);
      if (!t) {
        toast.push("error", "That grant doesn't exist on-chain.");
        return;
      }
      setCredential(cred);
      setTerms(t);
    } catch (e: any) {
      toast.push("error", String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [raw, toast]);

  function disconnect() {
    setCredential(null);
    setTerms(null);
    setRaw("");
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-neutral-900 bg-neutral-950/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-5 py-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-400 to-fuchsia-500 text-base font-black text-neutral-950">A</div>
          <div className="leading-tight">
            <div className="text-base font-bold text-neutral-50">{terms?.granteeLabel || "Agent"}</div>
            <div className="text-[11px] text-neutral-500">a third-party agent · powered by Handoff</div>
          </div>
          <Link href="/" className="ml-auto text-xs text-neutral-500 hover:text-neutral-300">← owner app</Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 py-8">
        {!credential ? (
          <ConnectCard raw={raw} setRaw={setRaw} connect={() => connect()} loading={loading} />
        ) : (
          <Workspace credential={credential} terms={terms!} refreshTerms={async () => setTerms(await readGrantTerms(credential.grantId))} disconnect={disconnect} />
        )}
        <footer className="mt-10 text-center text-xs text-neutral-600">
          This agent has no database of you. It reads and writes one scoped memory slice just-in-time, with your consent,
          through the Handoff gateway — and you can shred anything it wrote, with on-chain proof.
        </footer>
      </main>
    </div>
  );
}

function ConnectCard({ raw, setRaw, connect, loading }: { raw: string; setRaw: (s: string) => void; connect: () => void; loading: boolean }) {
  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6">
      <h1 className="text-xl font-bold text-neutral-50">Connect a memory grant</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Paste the access credential the user gave you. You&apos;ll be able to read — and save findings into — only the one
        category they granted, until it expires or they revoke it.
      </p>
      <textarea
        className="mt-4 h-28 w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 p-3 font-mono text-xs text-neutral-100 outline-none focus:border-indigo-500"
        placeholder='{"grantId":"0x…","credentialPrivateKey":"…"}'
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
      />
      <button
        className="mt-3 inline-flex w-full items-center justify-center rounded-lg bg-indigo-500 px-5 py-3 font-semibold text-neutral-950 hover:bg-indigo-400 disabled:opacity-50"
        onClick={connect}
        disabled={loading}
      >
        {loading ? "Checking grant…" : "Connect"}
      </button>
    </div>
  );
}

function Workspace({ credential, terms, refreshTerms, disconnect }: { credential: Credential; terms: GrantTerms; refreshTerms: () => Promise<void>; disconnect: () => void }) {
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const blocked = terms.status !== "active";

  async function ask() {
    const t = task.trim();
    if (!t || busy) return;
    setTask("");
    const history = messages.map((m) => ({ role: m.role, text: m.text })).filter((m) => m.text);
    setMessages((m) => [...m, { role: "user", text: t }]);
    setBusy(true);
    try {
      setPhase("pulling scoped memory…");
      const outcome = await agentRecall(credential, t);
      if (!outcome.allowed) {
        setMessages((m) => [...m, { role: "agent", text: "", denied: outcome.reason }]);
        await refreshTerms();
        return;
      }
      setPhase("thinking…");
      const comp = await (
        await fetch("/api/agent-complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task: t,
            agentLabel: terms.granteeLabel,
            category: outcome.namespace,
            memories: outcome.results.map((r) => r.text),
            history,
            canWrite: true,
          }),
        })
      ).json();

      // write what was learned back into the granted slice — signed with the
      // grant credential, enforced and audited from chain like every recall
      const saved: string[] = [];
      for (const fact of (comp.learned || []) as string[]) {
        setPhase("saving what I learned…");
        const w = await agentRemember(credential, fact);
        if (w.allowed) saved.push(fact);
      }

      setMessages((m) => [...m, { role: "agent", text: comp.answer, memories: outcome.results, saved, model: comp.model }]);
    } catch (e: any) {
      setMessages((m) => [...m, { role: "agent", text: "", denied: String(e?.message || e) }]);
    } finally {
      setBusy(false);
      setPhase("");
    }
  }

  return (
    <div>
      <GrantBanner terms={terms} onRefresh={refreshTerms} onDisconnect={disconnect} />

      <div className="mt-4 min-h-[18rem] rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
        {messages.length === 0 && (
          <div className="grid h-64 place-items-center text-center text-sm text-neutral-500">
            <div>
              <p>
                Ask {terms.granteeLabel} to work with your <span className="text-indigo-300">{terms.namespace}</span> memory.
                It can build on notes other agents left there — and saves what it learns.
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {["Catch up: where did we (or another agent) leave off?", "What do you know about me?", "Work on the task and save your findings"].map((s) => (
                  <button key={s} className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-400 hover:border-indigo-500 hover:text-indigo-300" onClick={() => setTask(s)}>{s}</button>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className="grid gap-3">
          {messages.map((m, i) => <Bubble key={i} m={m} />)}
          {busy && <div className="text-xs text-neutral-500">{terms.granteeLabel} is {phase || "working…"}</div>}
          <div ref={endRef} />
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <input
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-indigo-500 disabled:opacity-60"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          placeholder={blocked ? "Access revoked or expired — you can't touch this memory anymore." : `Ask ${terms.granteeLabel}…`}
          disabled={blocked}
        />
        <button className="rounded-lg bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-neutral-950 hover:bg-indigo-400 disabled:opacity-50" onClick={ask} disabled={busy || blocked}>Send</button>
      </div>
      {blocked && (
        <p className="mt-2 text-center text-xs text-amber-400">
          Try it anyway — the gateway will deny it from chain. Ask the owner to grant access again to continue.
        </p>
      )}
    </div>
  );
}

function GrantBanner({ terms, onRefresh, onDisconnect }: { terms: GrantTerms; onRefresh: () => void; onDisconnect: () => void }) {
  const tone = terms.status === "active" ? "indigo" : terms.status === "expired" ? "amber" : "red";
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-3 text-sm ${tone === "indigo" ? "border-indigo-900/70 bg-indigo-950/20" : tone === "amber" ? "border-amber-900/60 bg-amber-950/20" : "border-red-900/60 bg-red-950/20"}`}>
      <span className="font-medium text-neutral-200">Granted access</span>
      <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-indigo-300">{terms.namespace}</span>
      <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">read + write</span>
      <span className={`rounded border px-2 py-0.5 text-xs ${terms.status === "active" ? "border-indigo-700 bg-indigo-900/40 text-indigo-300" : terms.status === "expired" ? "border-amber-800 bg-amber-900/30 text-amber-300" : "border-red-800 bg-red-900/30 text-red-300"}`}>{terms.status}</span>
      {terms.status === "active" && <span className="text-xs text-neutral-500">expires {expiresIn(terms.expiresAt)}</span>}
      <span className="text-xs text-neutral-600">from {short(terms.grantor)}</span>
      <div className="ml-auto flex items-center gap-3 text-xs">
        <button className="text-neutral-400 hover:text-indigo-300" onClick={onRefresh}>re-check chain</button>
        <button className="text-neutral-500 hover:text-neutral-300" onClick={onDisconnect}>disconnect</button>
      </div>
    </div>
  );
}

/** Label a memory's origin for the agent view. */
function srcLabel(src?: string): string | null {
  if (!src || src === "you") return null;
  if (src === "capture") return "auto-captured";
  return `by ${src}`;
}

function Bubble({ m }: { m: Msg }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-neutral-800 px-3.5 py-2 text-sm text-neutral-100">{m.text}</div>
      </div>
    );
  }
  if (m.denied) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-red-900 bg-red-950/30 px-3.5 py-2 text-sm text-red-200">
          <span className="font-medium">Access denied by the gateway</span> — <span className="text-red-300">{m.denied.replace(/_/g, " ")}</span>. The owner controls this from chain; I can&apos;t touch the memory.
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-neutral-800 bg-neutral-950 px-3.5 py-2 text-sm text-neutral-200">
        <p className="whitespace-pre-wrap">{m.text}</p>
        {m.saved && m.saved.length > 0 && (
          <div className="mt-2 grid gap-1">
            {m.saved.map((s, i) => (
              <div key={i} className="flex items-start gap-1.5 rounded-lg border border-emerald-900/60 bg-emerald-950/20 px-2 py-1 text-xs text-emerald-300">
                <span aria-hidden>✍️</span>
                <span><span className="font-medium">saved to the vault:</span> {s}</span>
              </div>
            ))}
          </div>
        )}
        {m.memories && m.memories.length > 0 && (
          <details className="mt-2 text-xs text-neutral-500">
            <summary className="cursor-pointer hover:text-indigo-300">memory used ({m.memories.length}) {m.model && m.model !== "fallback" ? `· ${m.model}` : ""}</summary>
            <ul className="mt-1 list-disc pl-4">
              {m.memories.map((x, i) => (
                <li key={i}>
                  {x.text}
                  {srcLabel(x.src) && <span className="ml-1.5 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-fuchsia-300">{srcLabel(x.src)}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
