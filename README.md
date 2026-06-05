# Handoff

**Permissioned memory for AI agents.** Lend *scoped, revocable, time-boxed* slices of your
agent's memory to other AI agents and services — with every grant recorded and enforced on-chain.

> **Sui Overflow 2026 · Walrus track.** Built on [MemWal (Walrus Memory)](https://github.com/MystenLabs/MemWal) + [Sui](https://sui.io) + [Seal](https://github.com/MystenLabs/seal).

---

## The problem

AI memory is all-or-nothing. With MemWal, a delegate key can read **every** memory in your
account, across **every** namespace — there's no way to share just one slice, for a limited
time, and prove who you gave access to. So you either hand an external agent the keys to your
*entire* memory, or you share nothing.

## What Handoff adds

A **grant layer** on top of MemWal — think **OAuth for your AI's memory**:

- **Scoped** — share only a chosen slice (namespace), never the whole account.
- **Time-boxed** — grants carry an expiry; access ends automatically.
- **Revocable** — kill any grant instantly, on-chain.
- **Auditable** — grants are objects on Sui with `GrantCreated`/`GrantRevoked` events, plus a
  live access log of every recall a grantee attempts.

## How it works

```
 Third-party agent ──(grant credential, signed request)──▶  Handoff proxy ──▶ MemWal recall
   (e.g. ShopBot)                                                │              (granted slice only)
                                                                 │
                                                reads ▼          ▼ enforces
                                       Sui: Grant object  ·  not revoked + not expired
                                       (scope, expiry,     ·  namespace pinned to the grant
                                        grantee pubkey)    ·  credential signature verified
```

1. **Grant registry (Move contract on Sui)** — each grant is an on-chain object: which slice,
   which grantee (Ed25519 pubkey), expiry, revoked flag. Owner-gated revoke. Emits events.
2. **Handoff proxy** — holds the MemWal delegate key. On every request it verifies the caller
   signed with the grant's credential key, reads the on-chain grant (scope/expiry/revoked), and
   recalls MemWal **pinned to the granted namespace** — the grantee can never widen scope,
   outlive the expiry, or survive a revoke. Logs every access.
3. **Dashboard** (Next.js) — curate memory into slices, mint/inspect/revoke grants, watch the
   live access log.
4. **Demo agent (ShopBot)** — a third-party agent that holds *only* a grant credential and
   recalls through the proxy.

## Live on Sui testnet

| Thing | Value |
|---|---|
| Grant registry package | `0xb19b9636e267badd5493697e9f089d1e5eb2844e732261997bab402b5d7b7149` |
| Built on MemWal (testnet) | pkg `0xcf6ad755…29c6`, relayer `relayer-staging.memory.walrus.xyz` |

## Run it locally

Prereqs: Node 20+, pnpm, and the [`sui`](https://docs.sui.io/references/cli) CLI configured for
testnet with a funded address that owns a MemWal account (see `scripts/`). Local dev creds live
in `scripts/.owner.testnet.json` (gitignored).

```bash
# 1. validate the MemWal core (creates account + remember/recall)
cd scripts && pnpm install && node memory-test.mjs

# 2. start the proxy (enforcement gateway) — port 8787
cd ../proxy && pnpm install && node src/server.mjs

# 3. start the dashboard — http://localhost:3000
cd ../dashboard && pnpm install && pnpm dev

# 4. in the dashboard: add a memory to a slice, then "Create grant" and
#    "copy credential JSON". Save it to demo-agent/credential.json.

# 5. run the third-party agent
cd ../demo-agent && pnpm install && node agent.mjs
```

You'll see ShopBot read the **granted** slice, get **nothing** from ungranted/irrelevant
queries, and — after you click **Revoke** in the dashboard — get **denied** on its next call.

## Verified end-to-end

`proxy/test.mjs` proves: scoped recall works, the private slice never leaks, bad signatures are
rejected, and an on-chain revoke cuts access immediately. The dashboard→agent flow
(mint → scoped recall → revoke → deny) runs against live testnet.

## Repo layout

```
contracts/    Move grant-registry package (Sui)
proxy/        Access-control gateway (TypeScript / Hono)
dashboard/    Next.js control panel
demo-agent/   Example third-party agent (ShopBot)
scripts/      Setup + end-to-end validation
```

## License

MIT
