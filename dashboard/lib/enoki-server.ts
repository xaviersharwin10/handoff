/**
 * Server-only Enoki sponsorship. Holds the PRIVATE Enoki key and sponsors gas
 * for a strict allowlist of Handoff/MemWal Move calls, so the gas pool can only
 * ever pay for our own contract calls — never arbitrary transactions.
 */
import "server-only";
import { EnokiClient } from "@mysten/enoki";
import { TARGETS } from "./config";

const apiKey = process.env.ENOKI_SECRET_KEY;
if (!apiKey) throw new Error("ENOKI_SECRET_KEY is not set");

export const enoki = new EnokiClient({ apiKey });

/** The only Move-call targets the sponsor will ever pay for. */
export const ALLOWED_TARGETS = new Set<string>(Object.values(TARGETS));

export function assertAllowedTargets(targets: string[]) {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("allowedMoveCallTargets required");
  }
  for (const t of targets) {
    if (!ALLOWED_TARGETS.has(t)) throw new Error(`target not allowed: ${t}`);
  }
}
