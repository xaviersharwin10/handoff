"use client";

import { useCallback, useEffect, useState } from "react";
import { useSuiClient, useSignTransaction } from "@mysten/dapp-kit";
import { AccountGate, AccountChip } from "./account-gate";
import { HandoffProvider, useHandoff } from "./handoff-context";
import { ProvisionGate } from "./provision-gate";
import { useToast } from "./toast";
import {
  listGrantsForOwner, listAccessLog, listShredProofs,
  type GrantView, type AccessEntry, type ShredProof,
} from "@/lib/chain";
import { rememberMemory, recallMemory, listMemories, notifyShredded, type MemoryRow } from "@/lib/memory-client";
import { shredMemory, shredEverything } from "@/lib/vault-client";
import { createGrant, revokeGrant } from "@/lib/grants-client";
import { getCaptureToken } from "@/lib/capture-client";
import { GATEWAY_URL } from "@/lib/config";
import {
  MemoryIcon, KeyIcon, ActivityIcon, ShieldIcon, EyeIcon, ClockIcon,
  PlusIcon, CopyIcon, CheckIcon, ExternalIcon, SearchIcon, LockIcon, PlugIcon,
} from "./icons";

const SUGGESTED = ["shopping", "travel", "health", "work", "personal"];
const DURATIONS = [
  { label: "1 hour", ms: 60 * 60_000 },
  { label: "24 hours", ms: 24 * 60 * 60_000 },
  { label: "7 days", ms: 7 * 24 * 60 * 60_000 },
];

const short = (s: string) => (s?.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);
function expiresIn(ms: number): string {
  const d = ms - Date.now();
  if (d <= 0) return "expired";
  const m = Math.floor(d / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.floor(h / 24)}d`;
}

export default function Page() {
  return (
    <AccountGate>
      <HandoffProvider>
        <ProvisionGate>
          <Dashboard />
        </ProvisionGate>
      </HandoffProvider>
    </AccountGate>
  );
}

function Dashboard() {
  const [categories, setCategories] = useState<string[]>(SUGGESTED);
  const [grantCount, setGrantCount] = useState(0);
  const [memoryCount, setMemoryCount] = useState(0);

  const addCategory = useCallback((c: string) => {
    setCategories((cur) => (cur.includes(c) ? cur : [...cur, c]));
  }, []);

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto w-full max-w-5xl px-5 pb-16">
        <Intro />
        <GettingStarted hasMemory={memoryCount > 0} hasGrant={grantCount > 0} />
        <ConnectToolsSection />
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <MemorySection categories={categories} addCategory={addCategory} onAdded={() => setMemoryCount((n) => n + 1)} />
          <AgentsSection categories={categories} addCategory={addCategory} onCount={setGrantCount} />
        </div>
        <div className="mt-6">
          <ActivitySection />
        </div>
        <footer className="mt-10 text-center text-xs text-neutral-600">
          Handoff · verifiable agent memory with provable deletion · built on Walrus + Sui + Seal · Sui Overflow 2026
        </footer>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ chrome */

function TopBar() {
  const { accountId } = useHandoff();
  return (
    <header className="sticky top-0 z-30 border-b border-neutral-900 bg-neutral-950/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-5 py-3">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-base font-black text-neutral-950">H</div>
        <div className="leading-tight">
          <div className="text-base font-bold text-neutral-50">Handoff</div>
          <div className="text-[11px] text-neutral-500">verifiable agent memory · provable deletion</div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {accountId && (
            <a
              href={`https://testnet.suivision.xyz/object/${accountId}`}
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1 rounded-full border border-neutral-800 px-3 py-1 font-mono text-[11px] text-neutral-400 hover:border-emerald-700 hover:text-emerald-400 sm:flex"
              title="Your memory vault object on Sui"
            >
              vault {short(accountId)} <ExternalIcon className="h-3 w-3" />
            </a>
          )}
          <AccountChip />
        </div>
      </div>
    </header>
  );
}

function Intro() {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    setHidden(localStorage.getItem("handoff:hideIntro") === "1");
  }, []);
  if (hidden) return null;

  const steps = [
    { icon: <PlugIcon className="h-5 w-5" />, title: "Capture automatically", body: "Point your AI tools at one URL — every chat becomes encrypted memory only your vault can unlock." },
    { icon: <KeyIcon className="h-5 w-5" />, title: "Delegate to agents", body: "Grant any agent one category — it reads, works, and saves findings back. Agents hand off work to each other through your vault, every access audited on Sui." },
    { icon: <ShieldIcon className="h-5 w-5" />, title: "Erase with proof", body: "Shred anything — even what an agent learned about you. The on-chain proof shows it's cryptographically gone forever." },
  ];
  return (
    <section className="mt-6 rounded-2xl border border-neutral-800 bg-gradient-to-b from-neutral-900/80 to-neutral-900/30 p-5">
      <div className="flex items-start">
        <div>
          <h2 className="text-lg font-semibold text-neutral-50">The memory layer for AI agents — with an off switch you can prove.</h2>
          <p className="mt-1 max-w-2xl text-sm text-neutral-400">
            Your agents remember across sessions, tools, and each other: memory lives in <span className="text-cyan-300">a vault you own on Sui</span>,
            not in any provider&apos;s database. Agents you choose read — and write — one scoped slice, hand work off through it,
            and anything can be <span className="text-red-400">shredded with on-chain proof</span> —
            permanently undecryptable, even what an agent learned about you.
          </p>
        </div>
        <button
          className="ml-auto text-xs text-neutral-500 hover:text-neutral-300"
          onClick={() => { localStorage.setItem("handoff:hideIntro", "1"); setHidden(true); }}
        >
          dismiss
        </button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <div key={i} className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-4">
            <div className="mb-2 flex items-center gap-2 text-emerald-400">{s.icon}<span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Step {i + 1}</span></div>
            <div className="text-sm font-medium text-neutral-100">{s.title}</div>
            <div className="mt-1 text-xs text-neutral-500">{s.body}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function GettingStarted({ hasMemory, hasGrant }: { hasMemory: boolean; hasGrant: boolean }) {
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => { setDismissed(localStorage.getItem("handoff:hideStart") === "1"); }, []);
  if (dismissed || (hasMemory && hasGrant)) return null;
  return (
    <section className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-emerald-900/60 bg-emerald-950/20 px-4 py-3 text-sm">
      <span className="font-medium text-emerald-300">Get started</span>
      <Step done={hasMemory} n={1} label="Add a memory" />
      <span className="text-neutral-700">→</span>
      <Step done={hasGrant} n={2} label="Give an agent access" />
      <button
        className="ml-auto text-xs text-neutral-500 hover:text-neutral-300"
        onClick={() => { localStorage.setItem("handoff:hideStart", "1"); setDismissed(true); }}
      >
        dismiss
      </button>
    </section>
  );
}
function Step({ done, n, label }: { done: boolean; n: number; label: string }) {
  return (
    <span className={`flex items-center gap-1.5 ${done ? "text-emerald-400" : "text-neutral-300"}`}>
      <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${done ? "bg-emerald-500 text-neutral-950" : "border border-neutral-700 text-neutral-400"}`}>
        {done ? <CheckIcon className="h-3 w-3" /> : n}
      </span>
      {label}
    </span>
  );
}

/* --------------------------------------------------------- connect AI tools */

function ConnectToolsSection() {
  const { address, accountId } = useHandoff();
  const toast = useToast();
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const endpoint = `${GATEWAY_URL}/capture/v1`;

  async function generate() {
    if (!address || !accountId) return;
    setBusy(true);
    try {
      setToken(await getCaptureToken(address, accountId));
      setOpen(true);
      toast.push("success", "Connection key minted. Point any AI tool here — your memory fills itself.");
    } catch (e: any) {
      toast.push("error", String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-cyan-900/50 bg-gradient-to-b from-cyan-950/20 to-neutral-900/30 p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-cyan-500/10 text-cyan-400"><PlugIcon className="h-5 w-5" /></div>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-neutral-100">Connect your AI tools <span className="ml-1 rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cyan-300">passive capture</span></h2>
          <p className="text-sm text-neutral-500">
            Point Cursor, Chatbox, or any OpenAI-compatible app at one URL. Every chat is auto-distilled into durable
            memories, sorted into categories — <span className="text-cyan-300">you never type a memory by hand</span>. Then grant agents a slice.
          </p>
        </div>
        {!token && (
          <button className={`${primaryBtn} shrink-0`} onClick={generate} disabled={busy}>
            {busy ? "Minting…" : "Get connection key"}
          </button>
        )}
      </div>

      {token && (
        <div className="mt-4 grid gap-3">
          <Field label="Base URL" value={endpoint} hint="Set this as the API base URL / endpoint in your AI tool." />
          <Field label="API key" value={token} hint="Use as the API key / token. It can only WRITE memory to your vault — nothing else." secret />
          <button className="flex w-fit items-center gap-1.5 text-xs text-neutral-500 hover:text-cyan-300" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : "Show"} setup for Cursor / Chatbox / curl
          </button>
          {open && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-3 text-xs text-neutral-400">
              <p className="mb-1.5 text-neutral-300">Any OpenAI-compatible client works. For example:</p>
              <ul className="ml-4 list-disc space-y-1">
                <li><span className="text-neutral-200">Chatbox / Cursor:</span> set <em>API Host / Base URL</em> to the URL above and <em>API Key</em> to the key above. Pick any model name.</li>
                <li><span className="text-neutral-200">OpenAI SDK:</span> <code className="text-cyan-300">baseURL = &quot;{endpoint}&quot;</code>, <code className="text-cyan-300">apiKey = &quot;hoc_…&quot;</code>.</li>
              </ul>
              <pre className="mt-2 overflow-x-auto rounded bg-black/50 p-2 text-[11px] leading-relaxed text-neutral-300">{`curl ${endpoint}/chat/completions \\
  -H "authorization: Bearer ${token.slice(0, 16)}…" \\
  -H "content-type: application/json" \\
  -d '{"messages":[{"role":"user","content":"I'm vegan and fly out of SFO"}]}'`}</pre>
              <p className="mt-2 text-neutral-500">The reply streams back like any LLM. Seconds later, the durable facts appear in your categories below.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Field({ label, value, hint, secret }: { label: string; value: string; hint?: string; secret?: boolean }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [reveal, setReveal] = useState(!secret);
  function copy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    toast.push("success", `${label} copied.`);
    setTimeout(() => setCopied(false), 1500);
  }
  const shown = reveal ? value : value.replace(/.(?=.{6})/g, "•");
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</span>
        {secret && <button className="text-[11px] text-neutral-600 hover:text-neutral-300" onClick={() => setReveal((r) => !r)}>{reveal ? "hide" : "reveal"}</button>}
      </div>
      <div className="flex items-center gap-2">
        <code className="block flex-1 break-all rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-xs text-cyan-200">{shown}</code>
        <button className={ghostBtn} onClick={copy}>{copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}</button>
      </div>
      {hint && <p className="mt-1 text-[11px] text-neutral-600">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ shells */

function Section({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-neutral-800/80 text-emerald-400">{icon}</div>
        <div>
          <h2 className="text-base font-semibold text-neutral-100">{title}</h2>
          <p className="text-sm text-neutral-500">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

const inputCls = "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-emerald-500";
const primaryBtn = "inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-emerald-400 disabled:opacity-50";
const ghostBtn = "inline-flex items-center justify-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-2 text-sm font-medium text-neutral-200 hover:border-emerald-600 hover:text-emerald-400 disabled:opacity-50";

/* ------------------------------------------------------------------ memory */

function MemorySection({ categories, addCategory, onAdded }: { categories: string[]; addCategory: (c: string) => void; onAdded: () => void }) {
  const { address, accountId, vaultId, refresh } = useHandoff();
  const suiClient = useSuiClient();
  const { mutateAsync: signTransaction } = useSignTransaction();
  const toast = useToast();

  const [cat, setCat] = useState("shopping");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<MemoryRow[] | null>(null);
  const [nsCounts, setNsCounts] = useState<Record<string, number>>({});
  const [shredding, setShredding] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);

  const load = useCallback(async () => {
    if (!address || !accountId) return;
    try {
      const r = await listMemories(address, accountId, { limit: 30 });
      setRows(r.memories);
      setNsCounts(r.namespaces);
      Object.keys(r.namespaces).forEach(addCategory);
      if (r.memories.length > 0) onAdded();
    } catch {
      /* gateway warming up / transient */
    }
  }, [address, accountId, addCategory, onAdded]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000); // captured memories appear as they land
    return () => clearInterval(t);
  }, [load]);

  async function add() {
    if (!address || !accountId || !cat.trim() || !text.trim()) return;
    setBusy(true);
    try {
      await rememberMemory(address, accountId, cat.trim(), text.trim());
      addCategory(cat.trim());
      setText("");
      toast.push("success", `Encrypted into your vault under “${cat.trim()}”.`);
      await load();
    } catch (e: any) {
      toast.push("error", String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  /** Provable deletion: on-chain shred → key servers refuse this memory forever. */
  async function forget(m: MemoryRow) {
    if (!address || !accountId || !vaultId) return;
    setShredding(m.memId);
    try {
      const digest = await shredMemory({ suiClient, signTransaction: signTransaction as never, address, vaultId, memId: m.memId });
      await notifyShredded(address, accountId, { memId: m.memId });
      toast.push("success", "Shredded. The ciphertext is now permanently undecryptable — proof is on-chain.");
      console.log("shred proof tx:", digest);
      await load();
    } catch (e: any) {
      toast.push("error", String(e?.message || e));
    } finally {
      setShredding(null);
    }
  }

  async function panic() {
    if (!address || !accountId || !vaultId) return;
    if (!confirm("Shred EVERYTHING? Every memory in your vault becomes permanently undecryptable, with on-chain proof. This cannot be undone.")) return;
    setBusy(true);
    try {
      await shredEverything({ suiClient, signTransaction: signTransaction as never, address, vaultId });
      await notifyShredded(address, accountId, { all: true });
      toast.push("success", "Vault shredded. Everything is gone — provably.");
      setRows([]);
      setNsCounts({});
      await refresh();
    } catch (e: any) {
      toast.push("error", String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      icon={<MemoryIcon className="h-5 w-5" />}
      title="Your memory"
      subtitle="Typed here or captured from your AI tools — every item Seal-encrypted under keys only your vault controls."
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className={`${inputCls} sm:w-36`} value={cat} onChange={(e) => setCat(e.target.value)} placeholder="category" list="cat-list" />
          <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. I take 50mg sertraline daily" onKeyDown={(e) => e.key === "Enter" && add()} />
          <button className={primaryBtn} onClick={add} disabled={busy}>{busy ? "Saving…" : (<><PlusIcon className="h-4 w-4" /> Remember</>)}</button>
        </div>
        <datalist id="cat-list">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED.map((c) => (
            <button key={c} onClick={() => setCat(c)} className={`rounded-full border px-2.5 py-0.5 text-xs ${cat === c ? "border-emerald-600 bg-emerald-950/50 text-emerald-300" : "border-neutral-800 text-neutral-400 hover:border-neutral-600"}`}>{c}{nsCounts[c] ? ` · ${nsCounts[c]}` : ""}</button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        {!rows || rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-center text-sm text-neutral-500">
            {rows === null ? "Opening your vault…" : "Nothing here but you. Add a memory above, or connect a tool and chat — captured facts appear here."}
          </div>
        ) : (
          <div className="grid gap-2">
            <p className="text-[11px] uppercase tracking-wide text-neutral-600">In your vault — newest first</p>
            {rows.map((m) => (
              <div key={m.memId} className="group flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm">
                <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-emerald-400">{m.namespace}</span>
                <span className="text-neutral-300">
                  {m.text}
                  {m.src && m.src !== "you" && (
                    <span
                      className={`ml-2 rounded px-1.5 py-0.5 text-[10px] ${m.src === "capture" ? "bg-cyan-950/60 text-cyan-300" : "bg-fuchsia-950/60 text-fuchsia-300"}`}
                      title={m.src === "capture" ? "auto-distilled from your AI chats" : `written by the agent “${m.src}” through its grant`}
                    >
                      {m.src === "capture" ? "captured" : `by ${m.src}`}
                    </span>
                  )}
                </span>
                <button
                  className="ml-auto shrink-0 rounded px-2 py-0.5 text-xs text-neutral-600 hover:bg-red-950/60 hover:text-red-300 disabled:opacity-50"
                  title="Provably delete — on-chain shred, the ciphertext becomes permanently undecryptable"
                  onClick={() => forget(m)}
                  disabled={shredding === m.memId}
                >
                  {shredding === m.memId ? "Shredding…" : "Forget"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-4">
        <button className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-emerald-400" onClick={() => setShowSearch((s) => !s)}>
          <SearchIcon className="h-3.5 w-3.5" /> {showSearch ? "Hide search" : "Search your memory"}
        </button>
        {rows && rows.length > 0 && (
          <button className="ml-auto flex items-center gap-1.5 text-xs font-medium text-red-400/80 hover:text-red-300" onClick={panic} disabled={busy} title="Provably delete everything — irreversible">
            <ShieldIcon className="h-3.5 w-3.5" /> Shred everything
          </button>
        )}
      </div>
      {showSearch && <MemorySearch categories={categories} />}
    </Section>
  );
}

function MemorySearch({ categories }: { categories: string[] }) {
  const { address, accountId } = useHandoff();
  const toast = useToast();
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ text: string; namespace: string; score: number }[] | null>(null);

  async function run() {
    if (!address || !accountId || !q.trim()) return;
    setBusy(true);
    setResults(null);
    try {
      const r = await recallMemory(address, accountId, cat.trim() || undefined, q.trim());
      setResults(r.results);
    } catch (e: any) {
      toast.push("error", String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950/60 p-3">
      <p className="mb-2 text-xs text-neutral-500">Semantic search — ask in your own words; leave the category empty to search everything.</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className={`${inputCls} sm:w-36`} value={cat} onChange={(e) => setCat(e.target.value)} placeholder="any category" list="cat-list" />
        <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. what medication do I take?" onKeyDown={(e) => e.key === "Enter" && run()} />
        <button className={ghostBtn} onClick={run} disabled={busy}>{busy ? "Searching…" : "Search"}</button>
      </div>
      {results && (
        <div className="mt-3 grid gap-1.5">
          {results.length === 0 && <p className="text-sm text-neutral-600">No matches{cat ? ` in “${cat}”` : ""}.</p>}
          {results.map((r, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm">
              <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-emerald-400">{r.namespace}</span>
              <span className="text-neutral-300">{r.text}</span>
              <span className="ml-auto text-xs text-neutral-600">{r.score.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ agents */

function AgentsSection({ categories, addCategory, onCount }: { categories: string[]; addCategory: (c: string) => void; onCount: (n: number) => void }) {
  const { address, accountId } = useHandoff();
  const suiClient = useSuiClient();
  const { mutateAsync: signTransaction } = useSignTransaction();
  const toast = useToast();

  const [grants, setGrants] = useState<GrantView[]>([]);
  const [cat, setCat] = useState(categories[0] ?? "shopping");
  const [label, setLabel] = useState("");
  const [ttl, setTtl] = useState(DURATIONS[0].ms);
  const [busy, setBusy] = useState(false);
  const [credential, setCredential] = useState<{ grantId: string | null; credentialPrivateKey: string; granteeLabel: string } | null>(null);

  const load = useCallback(async () => {
    if (!address) return;
    try {
      const g = await listGrantsForOwner(suiClient, address);
      setGrants(g);
      onCount(g.length);
    } catch {
      /* ignore transient */
    }
  }, [address, suiClient, onCount]);
  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!address || !accountId || !cat.trim() || !label.trim()) return;
    setBusy(true);
    try {
      const cred = await createGrant({
        suiClient, signTransaction: signTransaction as never, address, accountId,
        namespace: cat.trim(), granteeLabel: label.trim(), ttlMs: ttl,
      });
      setCredential(cred);
      addCategory(cat.trim());
      setLabel("");
      toast.push("success", `${cred.granteeLabel} can now read your “${cat.trim()}” memory.`);
      await load();
    } catch (e: any) {
      toast.push("error", String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(g: GrantView) {
    try {
      await revokeGrant({ suiClient, signTransaction: signTransaction as never, address: address!, grantId: g.grantId });
      toast.push("success", `Revoked ${g.granteeLabel}'s access.`);
      await load();
    } catch (e: any) {
      toast.push("error", String(e?.message || e));
    }
  }

  const active = grants.filter((g) => g.status === "active");
  const past = grants.filter((g) => g.status !== "active");

  async function revokeAll() {
    if (!address || active.length === 0) return;
    if (!confirm(`Revoke access for all ${active.length} agent(s)? This is on-chain and immediate.`)) return;
    setBusy(true);
    try {
      for (const g of active) {
        await revokeGrant({ suiClient, signTransaction: signTransaction as never, address, grantId: g.grantId });
      }
      toast.push("success", `Revoked all ${active.length} agent(s).`);
      await load();
    } catch (e: any) {
      toast.push("error", String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      icon={<KeyIcon className="h-5 w-5" />}
      title="Agent access"
      subtitle="Grant an AI agent one category of your memory — it can read it and save findings back. Scoped, time-boxed, revocable."
    >
      <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_8rem_auto]">
          <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Agent name, e.g. ShopBot" />
          <input className={inputCls} value={cat} onChange={(e) => setCat(e.target.value)} placeholder="category" list="cat-list" />
          <select className={inputCls} value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>
            {DURATIONS.map((d) => <option key={d.ms} value={d.ms}>{d.label}</option>)}
          </select>
        </div>
        <button className={`${primaryBtn} mt-2 w-full`} onClick={create} disabled={busy}>{busy ? "Granting…" : (<><PlusIcon className="h-4 w-4" /> Give access</>)}</button>
      </div>

      {credential && <CredentialReveal credential={credential} onDismiss={() => setCredential(null)} />}

      <HandoffTeam categories={categories} addCategory={addCategory} onCreated={load} />

      {active.length > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-neutral-500">{active.length} agents have access</span>
          <button className="text-xs font-medium text-red-400 hover:text-red-300 disabled:opacity-50" onClick={revokeAll} disabled={busy}>Revoke all</button>
        </div>
      )}
      <div className="mt-4 grid gap-2">
        {grants.length === 0 && (
          <div className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-center text-sm text-neutral-500">
            No agents have access yet. Grant one a category above — it becomes a revocable object on Sui.
          </div>
        )}
        {active.map((g) => <GrantCard key={g.grantId} grant={g} onRevoke={() => revoke(g)} />)}
        {past.length > 0 && <p className="mt-2 text-[11px] uppercase tracking-wide text-neutral-600">Past</p>}
        {past.map((g) => <GrantCard key={g.grantId} grant={g} onRevoke={() => revoke(g)} />)}
      </div>
    </Section>
  );
}

/* ------------------------------------------------- multi-agent handoff team */

type TeamCred = { grantId: string | null; credentialPrivateKey: string; granteeLabel: string };

/**
 * One click → two scoped agents on the SAME memory slice. The Researcher works
 * and saves findings into the vault; the Writer reads them and continues — a
 * real agent-to-agent handoff, coordinated entirely through the user's vault
 * (two on-chain grants, every read/write audited, all of it shreddable).
 */
function HandoffTeam({ categories, addCategory, onCreated }: { categories: string[]; addCategory: (c: string) => void; onCreated: () => Promise<void> }) {
  const { address, accountId } = useHandoff();
  const suiClient = useSuiClient();
  const { mutateAsync: signTransaction } = useSignTransaction();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState("work");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [team, setTeam] = useState<{ namespace: string; researcher: TeamCred; writer: TeamCred } | null>(null);

  async function assemble() {
    if (!address || !accountId || !cat.trim()) return;
    setBusy(true);
    try {
      const ns = cat.trim();
      setStep("creating the Researcher's on-chain grant…");
      const researcher = await createGrant({
        suiClient, signTransaction: signTransaction as never, address, accountId,
        namespace: ns, granteeLabel: "Researcher", ttlMs: 24 * 60 * 60_000,
      });
      setStep("creating the Writer's on-chain grant…");
      const writer = await createGrant({
        suiClient, signTransaction: signTransaction as never, address, accountId,
        namespace: ns, granteeLabel: "Writer", ttlMs: 24 * 60 * 60_000,
      });
      setTeam({ namespace: ns, researcher, writer });
      addCategory(ns);
      toast.push("success", `Two agents now share your “${ns}” slice — and nothing else.`);
      await onCreated();
    } catch (e: any) {
      toast.push("error", String(e?.message || e));
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  function openAgent(cred: TeamCred) {
    localStorage.setItem("handoff:agentCred", JSON.stringify({ grantId: cred.grantId, credentialPrivateKey: cred.credentialPrivateKey }));
    window.open("/agent", "_blank");
  }

  return (
    <div className="mt-3 rounded-xl border border-fuchsia-900/50 bg-fuchsia-950/10 p-3">
      <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen((o) => !o)}>
        <span className="text-sm font-medium text-fuchsia-300">⇄ Multi-agent handoff</span>
        <span className="text-xs text-neutral-500">two agents, one memory slice — work passes through your vault</span>
        <span className="ml-auto text-xs text-neutral-600">{open ? "hide" : "try it"}</span>
      </button>

      {open && !team && (
        <div className="mt-3">
          <p className="text-xs text-neutral-400">
            One click creates two scoped agents on the same category: a <span className="text-fuchsia-300">Researcher</span> that
            digs in and saves findings, and a <span className="text-fuchsia-300">Writer</span> that picks up exactly where it left
            off. They coordinate only through your vault — both revocable, every read/write on-chain, all of it shreddable.
          </p>
          <div className="mt-2 flex gap-2">
            <input className={`${inputCls} sm:w-36`} value={cat} onChange={(e) => setCat(e.target.value)} placeholder="category" list="cat-list" />
            <button className={`${primaryBtn} flex-1`} onClick={assemble} disabled={busy}>
              {busy ? (step || "Assembling…") : "Assemble the team (2 on-chain grants)"}
            </button>
          </div>
        </div>
      )}

      {open && team && (
        <div className="mt-3 grid gap-2">
          <p className="text-xs text-neutral-400">
            Both agents share only your <span className="rounded bg-neutral-800 px-1.5 text-fuchsia-300">{team.namespace}</span> memory.
            Run them in order — that&apos;s the handoff:
          </p>
          <TeamRow n={1} cred={team.researcher} blurb="give it a task — it works and saves findings into your vault" onOpen={() => openAgent(team.researcher)} />
          <TeamRow n={2} cred={team.writer} blurb="ask it to continue — it reads the Researcher's notes and builds on them" onOpen={() => openAgent(team.writer)} />
          <p className="text-[11px] text-neutral-600">
            Tip: when they&apos;re done, revoke both below — or shred what they wrote, with on-chain proof.
          </p>
        </div>
      )}
    </div>
  );
}

function TeamRow({ n, cred, blurb, onOpen }: { n: number; cred: TeamCred; blurb: string; onOpen: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-fuchsia-900/50 text-xs font-bold text-fuchsia-300">{n}</span>
      <span className="font-medium text-neutral-100">{cred.granteeLabel}</span>
      <span className="text-xs text-neutral-500">{blurb}</span>
      <button className={`${ghostBtn} ml-auto shrink-0`} onClick={onOpen}>
        Open workspace ↗
      </button>
    </div>
  );
}

function CredentialReveal({ credential, onDismiss }: { credential: { grantId: string | null; credentialPrivateKey: string; granteeLabel: string }; onDismiss: () => void }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(JSON.stringify({ grantId: credential.grantId, credentialPrivateKey: credential.credentialPrivateKey }));
    setCopied(true);
    toast.push("success", "Credential copied.");
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="mt-3 rounded-xl border border-emerald-700 bg-emerald-950/40 p-3">
      <p className="text-sm font-medium text-emerald-300">Access key for “{credential.granteeLabel}” — shown once</p>
      <p className="mt-0.5 text-xs text-neutral-400">Hand this to the agent. It signs every request with this key; you can revoke it anytime.</p>
      <code className="mt-2 block break-all rounded bg-neutral-950 p-2 font-mono text-xs text-emerald-200">{credential.credentialPrivateKey}</code>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <button className={ghostBtn} onClick={copy}>{copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy key"}</button>
        <button
          className={ghostBtn}
          onClick={() => {
            localStorage.setItem("handoff:agentCred", JSON.stringify({ grantId: credential.grantId, credentialPrivateKey: credential.credentialPrivateKey }));
            window.open("/agent", "_blank");
          }}
        >
          <EyeIcon className="h-3.5 w-3.5" /> Hand to the agent ↗
        </button>
        <button className="ml-auto text-neutral-500 hover:text-neutral-300" onClick={onDismiss}>dismiss</button>
      </div>
    </div>
  );
}

function GrantCard({ grant, onRevoke }: { grant: GrantView; onRevoke: () => void }) {
  const [open, setOpen] = useState(false);
  const tone = grant.status === "active" ? "emerald" : grant.status === "expired" ? "amber" : "red";
  return (
    <div className={`rounded-xl border bg-neutral-950 ${grant.status === "active" ? "border-neutral-800" : "border-neutral-900 opacity-70"}`}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-neutral-800 text-xs font-bold text-neutral-300">{grant.granteeLabel.slice(0, 2).toUpperCase()}</span>
        <span className="font-medium text-neutral-100">{grant.granteeLabel}</span>
        <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-emerald-400">{grant.namespace}</span>
        <span className={`rounded border px-2 py-0.5 text-xs ${tone === "emerald" ? "border-emerald-700 bg-emerald-900/40 text-emerald-300" : tone === "amber" ? "border-amber-800 bg-amber-900/30 text-amber-300" : "border-red-800 bg-red-900/30 text-red-300"}`}>{grant.status}</span>
        {grant.status === "active" && <span className="flex items-center gap-1 text-xs text-neutral-500"><ClockIcon className="h-3.5 w-3.5" />expires {expiresIn(grant.expiresAt)}</span>}
        <div className="ml-auto flex items-center gap-3">
          {grant.status === "active" && (
            <button className="flex items-center gap-1 text-xs text-neutral-400 hover:text-emerald-400" onClick={() => setOpen((o) => !o)}>
              <EyeIcon className="h-3.5 w-3.5" /> {open ? "Hide" : "Preview"}
            </button>
          )}
          {grant.status === "active" && <button className="text-xs font-medium text-red-400 hover:text-red-300" onClick={onRevoke}>Revoke</button>}
        </div>
      </div>
      {open && grant.status === "active" && <AgentPreview grant={grant} />}
    </div>
  );
}

function AgentPreview({ grant }: { grant: GrantView }) {
  const { address, accountId } = useHandoff();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ text: string; score: number }[] | null>(null);

  async function run() {
    if (!address || !accountId || !q.trim()) return;
    setBusy(true);
    setResults(null);
    try {
      const r = await recallMemory(address, accountId, grant.namespace, q.trim());
      setResults(r.results);
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-neutral-900 bg-neutral-950/80 px-3 py-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs text-neutral-400">
        <ShieldIcon className="h-3.5 w-3.5 text-emerald-400" />
        What <span className="font-medium text-neutral-200">{grant.granteeLabel}</span> can see — only your <span className="rounded bg-neutral-800 px-1.5 text-emerald-400">{grant.namespace}</span> memory. Every other category stays private.
      </p>
      <div className="flex gap-2">
        <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${grant.granteeLabel} would run…`} onKeyDown={(e) => e.key === "Enter" && run()} />
        <button className={ghostBtn} onClick={run} disabled={busy}>{busy ? "…" : "Run"}</button>
      </div>
      {results && (
        <div className="mt-2 grid gap-1.5">
          {results.length === 0 && <p className="text-xs text-neutral-600">No matches in this category.</p>}
          {results.map((r, i) => (
            <div key={i} className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 px-3 py-1.5 text-sm text-neutral-200">{r.text}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ activity */

function ActivitySection() {
  const { accountId, vaultId } = useHandoff();
  const suiClient = useSuiClient();
  const [entries, setEntries] = useState<AccessEntry[]>([]);
  const [proofs, setProofs] = useState<ShredProof[]>([]);

  const load = useCallback(async () => {
    if (!accountId) return;
    try {
      setEntries(await listAccessLog(suiClient, accountId));
      if (vaultId) setProofs(await listShredProofs(suiClient, vaultId));
    } catch {
      /* transient RPC error — keep last entries */
    }
  }, [accountId, vaultId, suiClient]);
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <Section
      icon={<ActivityIcon className="h-5 w-5" />}
      title="Activity"
      subtitle="Every access decision and every deletion, recorded on-chain. A tamper-proof audit trail, not a log we keep."
    >
      {proofs.length > 0 && (
        <div className="mb-3 grid gap-1.5">
          <p className="text-[11px] uppercase tracking-wide text-neutral-600">Deletion proofs</p>
          {proofs.map((p, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-red-950 bg-red-950/20 px-3 py-1.5 text-sm">
              <span className="rounded bg-red-900/60 px-2 py-0.5 text-xs font-medium text-red-300">SHREDDED</span>
              <span className="text-neutral-300">{p.kind === "everything" ? "entire vault" : `memory ${p.memId?.slice(0, 8)}…`}</span>
              <span className="text-xs text-neutral-500">permanently undecryptable</span>
              {p.txDigest && (
                <a href={`https://testnet.suivision.xyz/txblock/${p.txDigest}`} target="_blank" rel="noreferrer" className="text-[10px] text-red-400/70 hover:text-red-300" title="the on-chain proof of deletion">proof on-chain ↗</a>
              )}
              <span className="ml-auto text-xs text-neutral-600">{new Date(p.at).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}
      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-center text-sm text-neutral-500">
          No access attempts yet. When an agent uses its key, each decision is written on-chain and shows up here.
        </div>
      ) : (
        <div className="grid gap-1.5">
          {entries.map((e, i) => {
            const wrote = e.allowed && e.reason === "remember";
            return (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm">
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${wrote ? "bg-fuchsia-900/50 text-fuchsia-300" : e.allowed ? "bg-emerald-900/60 text-emerald-300" : "bg-red-900/50 text-red-300"}`}>{wrote ? "WROTE" : e.allowed ? "READ" : "DENY"}</span>
              {e.granteeLabel && <span className="text-neutral-300">{e.granteeLabel}</span>}
              {e.namespace && <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-emerald-400">{e.namespace}</span>}
              {!e.allowed && e.reason && <span className="text-xs text-red-400">{e.reason.replace(/_/g, " ")}</span>}
              {wrote && <span className="text-xs text-neutral-500">saved 1 memory to your vault</span>}
              {e.allowed && !wrote && <span className="text-xs text-neutral-500">{e.resultCount} result(s)</span>}
              {e.grantId && (
                <a href={`https://testnet.suivision.xyz/txblock?tab=Events`} target="_blank" rel="noreferrer" className="text-[10px] text-neutral-700 hover:text-emerald-400" title="on-chain audit event">on-chain ↗</a>
              )}
              <span className="ml-auto text-xs text-neutral-600">{new Date(e.at).toLocaleTimeString()}</span>
            </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
