# Handoff

**Permissioned memory for AI agents.** Lend *scoped, revocable, time-boxed* slices of your
agent's memory to other AI agents and services — with every grant recorded on-chain.

> Built for **Sui Overflow 2026** · Walrus track · on [MemWal (Walrus Memory)](https://github.com/MystenLabs/MemWal) + [Sui](https://sui.io) + [Seal](https://github.com/MystenLabs/seal).

---

## The problem

AI memory today is all-or-nothing. With MemWal, a delegate key can read **every** memory in
your account, across **every** namespace — there's no way to share just one slice, for a
limited time, and prove who you gave access to. So you either hand an external agent the keys
to your entire memory, or you share nothing.

## What Handoff adds

A **grant layer** on top of MemWal:

- **Scoped** — share only a chosen slice (namespace) of your memory, not the whole account.
- **Time-boxed** — grants carry an expiry; access ends automatically.
- **Revocable** — kill any grant instantly.
- **Auditable** — grants live as objects on Sui, with on-chain `GrantCreated` / `GrantRevoked`
  events and an access log. You can *prove* exactly who could see what, and when.

Think of it as **OAuth for your AI's memory.**

## How it works

```
Third-party AI agent ──(grant credential)──▶ Handoff proxy ──▶ MemWal recall (scoped slice)
                                                  │
                                                  ▼
                                   Sui: Grant object (scope, expiry, status)
                                        + GrantCreated / GrantRevoked events
```

- A **Move grant-registry contract** on Sui holds each grant (scope, grantee, expiry, status).
- The **Handoff proxy** holds the MemWal delegate key, verifies the on-chain grant on every
  request, and returns only memories from the granted namespace — never more.
- A **dashboard** lets you curate memory, mint/inspect/revoke grants, and watch the access log.

## Status

🚧 Built during Sui Overflow 2026 (May–June 2026). Core MemWal integration validated on
Sui testnet; grant contract, proxy, and dashboard in progress.

## Repo layout

```
contracts/    Move grant-registry package (Sui)
proxy/        Access-control gateway (TypeScript)
dashboard/    Next.js control panel
demo-agent/   Example third-party agent that recalls via a Handoff grant
scripts/      Setup + end-to-end validation scripts
```

## License

MIT
