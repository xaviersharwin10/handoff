/**
 * Proxy configuration.
 *
 * Public deployment values come from handoff/config.testnet.json (committed).
 * The only secret is the proxy delegate key — a single Ed25519 key that is
 * registered as a delegate on EVERY user's MemWal account at provisioning, so
 * the proxy can recall scoped slices for any grantor without per-user secrets.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", ".."); // handoff/

const pub = JSON.parse(readFileSync(resolve(root, "config.testnet.json"), "utf8"));

const delegateKey = process.env.PROXY_DELEGATE_KEY;
if (!delegateKey) {
  throw new Error("Missing PROXY_DELEGATE_KEY (set it in proxy/.env or the environment).");
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  suiRpcUrl: pub.suiRpcUrl,
  handoffPackageId: pub.handoff.packageId,
  relayerUrl: pub.memwal.relayerUrl,
  // single delegate key, valid on every provisioned account
  delegateKey,
  proxyDelegateAddress: pub.proxy?.delegateAddress,
  // reject signed requests older than this (anti-replay)
  maxRequestAgeMs: 60_000,
  // OpenAI-compatible upstream for the capture proxy (forward + memory extraction).
  // Free default: Groq. Same provider-agnostic contract as the dashboard agent.
  llm: {
    apiKey: process.env.LLM_API_KEY || "",
    baseUrl: (process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, ""),
    model: process.env.LLM_MODEL || "llama-3.3-70b-versatile",
  },
  // Self-Seal memory layer (own index, Walrus-native — no MemWal relayer).
  vault: {
    packageId: pub.vault.packageId,
    registryId: pub.vault.registryId,
  },
  seal: pub.seal, // { threshold, keyServers: [{objectId, weight}] }
  walrus: pub.walrus, // { publisherUrl, aggregatorUrl, epochs }
  memwalRegistryId: pub.memwal.registryId,
};
