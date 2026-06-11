/**
 * Per-browser device key (Ed25519). Registered as a delegate on the user's
 * MemWal account at provisioning, it lets this browser authenticate memory
 * operations: the server verifies the signature against the account's on-chain
 * delegate list — no shared secret, no database.
 *
 * Losing it (cleared storage) just means re-authorizing the device (a cheap,
 * sponsored add_delegate_key). Memories persist regardless.
 */
import * as ed from "@noble/ed25519";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";

const PREFIX = "handoff:devkey:";

export type DeviceKey = {
  privHex: string;
  pubHex: string;
  pubBytes: Uint8Array;
  suiAddress: string;
};

function toHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function fromPriv(privHex: string): Promise<DeviceKey> {
  const priv = fromHex(privHex);
  const pubBytes = await ed.getPublicKeyAsync(priv);
  const suiAddress = new Ed25519PublicKey(pubBytes).toSuiAddress();
  return { privHex, pubHex: toHex(pubBytes), pubBytes, suiAddress };
}

/** Get this browser's device key for an address, creating + persisting one if needed. */
export async function getOrCreateDeviceKey(address: string): Promise<DeviceKey> {
  const k = PREFIX + address;
  let privHex = typeof localStorage !== "undefined" ? localStorage.getItem(k) : null;
  if (!privHex) {
    privHex = toHex(ed.utils.randomPrivateKey());
    localStorage.setItem(k, privHex);
  }
  return fromPriv(privHex);
}

/** Sign a message with this browser's device key (must already exist). */
export async function signWithDeviceKey(address: string, message: string): Promise<string> {
  const privHex = localStorage.getItem(PREFIX + address);
  if (!privHex) throw new Error("device key missing — re-authorize this device");
  const sig = await ed.signAsync(new TextEncoder().encode(message), fromHex(privHex));
  return toHex(sig);
}
