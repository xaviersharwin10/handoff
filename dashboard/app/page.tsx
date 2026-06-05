"use client";

import { useCallback, useEffect, useState } from "react";

type Mem = { namespace: string; text: string; at: string };
type Grant = {
  grantId: string;
  namespace: string;
  granteeLabel: string;
  expiresAt: number;
  revoked: boolean;
  status: "active" | "expired" | "revoked";
};
type LogEntry = {
  at: string;
  allowed: boolean;
  reason?: string;
  granteeLabel?: string;
  namespace?: string;
  query?: string;
  resultCount?: number;
};

const TTL_OPTIONS = [
  { label: "5 minutes", ms: 5 * 60_000 },
  { label: "1 hour", ms: 60 * 60_000 },
  { label: "24 hours", ms: 24 * 60 * 60_000 },
];

async function jget(url: string) {
  return (await fetch(url, { cache: "no-store" })).json();
}
async function jpost(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: r.ok, data: await r.json() };
}
const short = (s: string) => (s?.length > 14 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s);
const fmtTime = (ms: number) => new Date(ms).toLocaleString();

export default function Dashboard() {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-8">
      <Header />
      <div className="mt-8 grid gap-6">
        <MemoryPanel />
        <GrantsPanel />
        <AccessLogPanel />
      </div>
      <footer className="mt-10 pb-6 text-center text-xs text-neutral-600">
        Handoff · permissioned memory for AI agents · Sui Overflow 2026 · built on MemWal + Sui + Seal
      </footer>
    </main>
  );
}

function Header() {
  return (
    <header className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-lg font-black text-neutral-950">
          H
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-50">Handoff</h1>
          <p className="text-sm text-neutral-400">
            Lend <span className="text-emerald-400">scoped, revocable, time-boxed</span> slices of your AI memory — enforced on-chain.
          </p>
        </div>
        <span className="ml-auto rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1 text-xs text-neutral-400">
          OAuth for AI memory
        </span>
      </div>
    </header>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-neutral-100">{title}</h2>
        {subtitle && <p className="text-sm text-neutral-500">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

const inputCls =
  "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500";
const btnCls =
  "rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-emerald-400 disabled:opacity-50";

function MemoryPanel() {
  const [mems, setMems] = useState<Mem[]>([]);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [ns, setNs] = useState("personal");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const d = await jget("/api/memory");
    setMems(d.memories || []);
    setNamespaces(d.namespaces || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!ns.trim() || !text.trim()) return;
    setBusy(true);
    await jpost("/api/memory", { namespace: ns.trim(), text: text.trim() });
    setText("");
    await load();
    setBusy(false);
  }

  return (
    <Card title="Your memory" subtitle="Add memories into slices (namespaces). Each slice can be granted independently.">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className={`${inputCls} sm:w-40`} value={ns} onChange={(e) => setNs(e.target.value)} placeholder="slice (namespace)" list="ns-list" />
        <datalist id="ns-list">{namespaces.map((n) => <option key={n} value={n} />)}</datalist>
        <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. I'm vegan and allergic to peanuts" onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className={btnCls} onClick={add} disabled={busy}>{busy ? "Saving…" : "Remember"}</button>
      </div>
      <div className="mt-4 grid gap-2">
        {mems.length === 0 && <p className="text-sm text-neutral-600">No memories yet. Add one above — it&apos;s encrypted and stored on Walrus.</p>}
        {mems.map((m, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm">
            <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-emerald-400">{m.namespace}</span>
            <span className="text-neutral-300">{m.text}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function GrantsPanel() {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [ns, setNs] = useState("");
  const [label, setLabel] = useState("");
  const [ttl, setTtl] = useState(TTL_OPTIONS[1].ms);
  const [busy, setBusy] = useState(false);
  const [credential, setCredential] = useState<{ grantId: string; credentialPrivateKey: string; granteeLabel: string } | null>(null);

  const load = useCallback(async () => {
    const [g, m] = await Promise.all([jget("/api/grants"), jget("/api/memory")]);
    setGrants(g.grants || []);
    setNamespaces(m.namespaces || []);
    setNs((cur) => cur || m.namespaces?.[0] || "");
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!ns.trim() || !label.trim()) return;
    setBusy(true);
    const { ok, data } = await jpost("/api/grants", { namespace: ns.trim(), granteeLabel: label.trim(), ttlMs: ttl });
    if (ok) { setCredential(data); setLabel(""); await load(); }
    setBusy(false);
  }
  async function revoke(grantId: string) {
    await jpost("/api/grants/revoke", { grantId });
    await load();
  }

  return (
    <Card title="Grants" subtitle="Hand a slice of memory to another agent — scoped, expiring, revocable. Each grant is an object on Sui.">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className={`${inputCls} sm:w-40`} value={ns} onChange={(e) => setNs(e.target.value)} placeholder="slice" list="ns-list" />
        <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="grantee, e.g. ShopBot" />
        <select className={`${inputCls} sm:w-40`} value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>
          {TTL_OPTIONS.map((o) => <option key={o.ms} value={o.ms}>{o.label}</option>)}
        </select>
        <button className={btnCls} onClick={create} disabled={busy}>{busy ? "Minting…" : "Create grant"}</button>
      </div>

      {credential && (
        <div className="mt-3 rounded-lg border border-emerald-700 bg-emerald-950/40 p-3 text-sm">
          <p className="font-medium text-emerald-300">Grant credential for &ldquo;{credential.granteeLabel}&rdquo; — shown once, copy it now:</p>
          <code className="mt-1 block break-all rounded bg-neutral-950 p-2 text-xs text-emerald-200">{credential.credentialPrivateKey}</code>
          <div className="mt-1 flex gap-3 text-xs text-neutral-400">
            <button className="text-emerald-400 hover:underline" onClick={() => navigator.clipboard.writeText(JSON.stringify(credential))}>copy credential JSON</button>
            <span>grant {short(credential.grantId)}</span>
            <button className="ml-auto text-neutral-500 hover:text-neutral-300" onClick={() => setCredential(null)}>dismiss</button>
          </div>
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-lg border border-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-900 text-xs uppercase text-neutral-500">
            <tr><th className="px-3 py-2">Grantee</th><th className="px-3 py-2">Slice</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Expires</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody>
            {grants.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-neutral-600">No grants yet.</td></tr>}
            {grants.map((g) => (
              <tr key={g.grantId} className="border-t border-neutral-800">
                <td className="px-3 py-2 text-neutral-200">{g.granteeLabel}</td>
                <td className="px-3 py-2"><span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-emerald-400">{g.namespace}</span></td>
                <td className="px-3 py-2"><StatusBadge status={g.status} /></td>
                <td className="px-3 py-2 text-xs text-neutral-400">{fmtTime(g.expiresAt)}</td>
                <td className="px-3 py-2 text-right">
                  {g.status === "active" && <button className="text-xs font-medium text-red-400 hover:underline" onClick={() => revoke(g.grantId)}>Revoke</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function StatusBadge({ status }: { status: Grant["status"] }) {
  const map = {
    active: "bg-emerald-900/60 text-emerald-300 border-emerald-700",
    expired: "bg-amber-900/40 text-amber-300 border-amber-800",
    revoked: "bg-red-900/40 text-red-300 border-red-800",
  } as const;
  return <span className={`rounded border px-2 py-0.5 text-xs ${map[status]}`}>{status}</span>;
}

function AccessLogPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    const d = await jget("/api/access-log");
    setEntries(d.entries || []);
    setOffline(Boolean(d.proxyOffline));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <Card title="Access log" subtitle="Every recall a granted agent attempts — allowed or denied, with the reason. The audit trail MemWal can't give you.">
      {offline && <p className="mb-2 text-xs text-amber-400">Proxy offline — start it with <code className="text-amber-300">pnpm --dir proxy start</code></p>}
      <div className="grid gap-1.5">
        {entries.length === 0 && <p className="text-sm text-neutral-600">No access attempts yet.</p>}
        {entries.map((e, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm">
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${e.allowed ? "bg-emerald-900/60 text-emerald-300" : "bg-red-900/50 text-red-300"}`}>
              {e.allowed ? "ALLOW" : "DENY"}
            </span>
            {e.granteeLabel && <span className="text-neutral-300">{e.granteeLabel}</span>}
            {e.namespace && <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-emerald-400">{e.namespace}</span>}
            {e.query && <span className="text-neutral-400">&ldquo;{e.query}&rdquo;</span>}
            {!e.allowed && e.reason && <span className="text-xs text-red-400">{e.reason}</span>}
            {e.allowed && <span className="text-xs text-neutral-500">{e.resultCount} result(s)</span>}
            <span className="ml-auto text-xs text-neutral-600">{new Date(e.at).toLocaleTimeString()}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
