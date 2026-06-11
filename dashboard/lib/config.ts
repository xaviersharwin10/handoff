/**
 * Public Handoff config — safe to ship to the browser.
 * Mirrors ../../config.testnet.json (kept inline so it bundles cleanly on the
 * client without importing a file outside the Next output-tracing root).
 *
 * Secrets (Enoki private key, proxy delegate private key) live only in env and
 * are read exclusively in server routes — never here.
 */
export const NETWORK = "testnet" as const;

export const RPC_URL = "https://fullnode.testnet.sui.io:443";

/** Handoff grant-registry Move package. */
export const HANDOFF = {
  packageId: "0x524cf0a119a759b4b7375bd93cbdbcce480ff3e7791f20f0ec82aa8db05126cb",
  module: "grants",
} as const;

/** Walrus Memory (MemWal) on-chain + relayer config. */
export const MEMWAL = {
  packageId: "0xcf6ad755a1cdff7217865c796778fabe5aa399cb0cf2eba986f4b582047229c6",
  registryId: "0xe80f2feec1c139616a86c9f71210152e2a7ca552b20841f2e192f99f75864437",
  relayerUrl: "https://relayer-staging.memory.walrus.xyz",
} as const;

/**
 * The single proxy delegate key registered on every user's MemWal account at
 * provisioning. Public values only (address + ed25519 pubkey). The matching
 * private key lives in the proxy/server env.
 */
export const PROXY_DELEGATE = {
  address: "0x4fa55b5aa8b56b01bd4e0d935d67b7099ab7ee14a0898e0b0af595ed0cfa8e96",
  pubkeyHex: "ef7d4482e9184650b44f5714d75f690c14c7f28c9544186a0e7684ba66ba5716",
  label: "handoff-proxy",
} as const;

/** Handoff Vault — the on-chain Seal policy for the user's memory (provable deletion). */
export const VAULT = {
  packageId: "0x0064dba2a96c88235564f351307addbe0609180d59e44e03b626e939281d4019",
  registryId: "0x96d44f1911e8127c1f61588089cdf034239f91def3c9f14f34bd280573ecab01",
} as const;

export const CLOCK_ID = "0x6";

/** The Handoff gateway (proxy) that enforces grants for third-party agents. */
export const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL || "http://localhost:8787";

// ----- fully-qualified Move call targets (used for Enoki sponsorship allowlists) -----
export const TARGETS = {
  createAccount: `${MEMWAL.packageId}::account::create_account`,
  addDelegateKey: `${MEMWAL.packageId}::account::add_delegate_key`,
  removeDelegateKey: `${MEMWAL.packageId}::account::remove_delegate_key`,
  createGrant: `${HANDOFF.packageId}::${HANDOFF.module}::create_grant`,
  revokeGrant: `${HANDOFF.packageId}::${HANDOFF.module}::revoke_grant`,
  createVault: `${VAULT.packageId}::vault::create`,
  addVaultDelegate: `${VAULT.packageId}::vault::add_delegate`,
  shredOne: `${VAULT.packageId}::vault::shred_one`,
  shredAll: `${VAULT.packageId}::vault::shred_all`,
} as const;
