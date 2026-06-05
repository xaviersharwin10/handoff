/**
 * Server-only Handoff logic for the dashboard.
 *
 * Holds the owner key (dev mode) and: seeds memory via MemWal, mints/revokes
 * grants via the `sui` CLI, lists grants from on-chain GrantCreated events,
 * and proxies the access log.
 */
import "server-only";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import * as ed from "@noble/ed25519";
import { MemWal } from "@mysten-incubation/memwal";

const ROOT = resolve(process.cwd(), ".."); // handoff/
const pub = JSON.parse(readFileSync(resolve(ROOT, "config.testnet.json"), "utf8"));
const creds = JSON.parse(readFileSync(resolve(ROOT, "scripts", ".owner.testnet.json"), "utf8"));

export const CFG = {
  rpc: pub.suiRpcUrl as string,
  pkg: pub.handoff.packageId as string,
  relayer: pub.memwal.relayerUrl as string,
  account: creds.accountId as string,
  ownerAddress: creds.ownerAddress as string,
  delegateKey: creds.delegatePrivateKey as string,
  proxyUrl: process.env.PROXY_URL || "http://localhost:8787",
};

const SUI_ENV = { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` };
function sui(args: string[]): any {
  const out = execFileSync("sui", args, { encoding: "utf8", env: SUI_ENV, maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(out);
}

async function rpc(method: string, params: unknown[]) {
  const r = await fetch(CFG.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await r.json()).result;
}

// ---------- memory (local display cache + real relayer writes) ----------
const DATA = resolve(process.cwd(), "data");
const MEMFILE = resolve(DATA, "memories.json");
type Mem = { namespace: string; text: string; at: string };

function readMems(): Mem[] {
  return existsSync(MEMFILE) ? JSON.parse(readFileSync(MEMFILE, "utf8")) : [];
}
function writeMems(m: Mem[]) {
  if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
  writeFileSync(MEMFILE, JSON.stringify(m, null, 2));
}

function memwal(namespace: string) {
  return MemWal.create({ key: CFG.delegateKey, accountId: CFG.account, serverUrl: CFG.relayer, namespace });
}

export async function addMemory(namespace: string, text: string) {
  await memwal(namespace).rememberAndWait(text);
  const mems = readMems();
  mems.unshift({ namespace, text, at: new Date().toISOString() });
  writeMems(mems);
  return { ok: true };
}

export function listMemories() {
  const mems = readMems();
  const namespaces = [...new Set(mems.map((m) => m.namespace))];
  return { memories: mems, namespaces };
}

export async function recallPreview(namespace: string, query: string) {
  const r = await memwal(namespace).recall({ query, limit: 5 });
  return r.results.map((m: any) => ({ text: m.text, distance: m.distance }));
}

// ---------- grants ----------
export type GrantView = {
  grantId: string;
  namespace: string;
  granteeLabel: string;
  grantor: string;
  expiresAt: number;
  revoked: boolean;
  status: "active" | "expired" | "revoked";
};

export async function createGrant(namespace: string, granteeLabel: string, ttlMs: number) {
  const credPriv = ed.utils.randomPrivateKey();
  const credPub = await ed.getPublicKeyAsync(credPriv);
  const pubArray = "[" + Array.from(credPub).join(",") + "]";
  const j = sui([
    "client", "call",
    "--package", CFG.pkg, "--module", "grants", "--function", "create_grant",
    "--args", CFG.account, namespace, granteeLabel, pubArray, String(ttlMs), "0x6",
    "--gas-budget", "100000000", "--json",
  ]);
  const obj = (j.objectChanges || []).find((o: any) => o.objectType?.includes("::grants::Grant"));
  if (!obj) throw new Error("grant object not found in tx output");
  return {
    grantId: obj.objectId as string,
    credentialPrivateKey: Buffer.from(credPriv).toString("hex"),
    namespace,
    granteeLabel,
  };
}

export function revokeGrant(grantId: string) {
  sui([
    "client", "call",
    "--package", CFG.pkg, "--module", "grants", "--function", "revoke_grant",
    "--args", grantId, "0x6", "--gas-budget", "100000000", "--json",
  ]);
  return { ok: true };
}

export async function listGrants(): Promise<GrantView[]> {
  const events = await rpc("suix_queryEvents", [
    { MoveEventType: `${CFG.pkg}::grants::GrantCreated` },
    null,
    50,
    true, // descending (newest first)
  ]);
  const ids: string[] = (events?.data || [])
    .filter((e: any) => e.parsedJson?.grantor === CFG.ownerAddress)
    .map((e: any) => e.parsedJson.grant_id);
  if (ids.length === 0) return [];

  const objs = await rpc("sui_multiGetObjects", [ids, { showContent: true }]);
  const now = Date.now();
  return (objs || [])
    .map((o: any) => o?.data?.content?.fields)
    .filter(Boolean)
    .map((f: any) => {
      const expiresAt = Number(f.expires_at);
      const revoked = Boolean(f.revoked);
      const status: GrantView["status"] = revoked ? "revoked" : now >= expiresAt ? "expired" : "active";
      return {
        grantId: f.id?.id ?? f.id,
        namespace: f.namespace,
        granteeLabel: f.grantee_label,
        grantor: f.grantor,
        expiresAt,
        revoked,
        status,
      };
    });
}

export async function accessLog() {
  try {
    const r = await fetch(`${CFG.proxyUrl}/access-log`, { cache: "no-store" });
    return await r.json();
  } catch {
    return { total: 0, entries: [], proxyOffline: true };
  }
}
