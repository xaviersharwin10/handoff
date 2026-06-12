# Handoff

**Verifiable memory for AI agents — with an off switch you can prove.**

Agents are stateless: they forget between sessions, can't share context across tools, and their memory — when they have one — is locked in a provider's database. Handoff is the memory layer that fixes that *without creating a new surveillance database*: every memory is **Seal-encrypted under an on-chain policy only you control**, agents you choose can **read it and write their findings back**, agents **hand work off to each other through the vault**, and any of it can be **shredded with on-chain proof** — permanently undecryptable, even though the encrypted bytes live on a public network.

> **Sui Overflow 2026 · Walrus track.** Built directly on [Walrus](https://walrus.xyz) (storage) + [Seal](https://github.com/MystenLabs/seal) (threshold encryption) + [Sui](https://sui.io) (policy & audit) + [Enoki zkLogin](https://docs.enoki.mystenlabs.com) (no wallet).
>
> New to any of those terms? **[HOW_IT_WORKS.md](HOW_IT_WORKS.md)** explains the entire product from zero — every building block, every flow, the security model, and an honest FAQ.

---

## The problem

Agent memory today is either **absent** (stateless agents that re-ask everything), **siloed** (each tool/app keeps its own fragment of you), or **someone else's database** (you can't see it, move it, scope it — and "delete" is a promise, not proof). So agents stay dumber than they should be, multi-agent workflows lose state at every handoff, and people self-censor with AI exactly where it could help most.

## What Handoff is

One memory layer under all your AI — with properties no centralized memory can offer:

1. **Agents remember and build over time.** Any agent you authorize gets `recall` *and* `remember` over one scoped slice: it reads your context, works, and saves durable findings back — provenance-tagged with its name. Your tools fill the vault passively too: point any OpenAI-compatible app (Cursor, Chatbox, the OpenAI SDK) at one URL and every chat is auto-distilled into durable, categorized, encrypted memories.
2. **Agents hand work off through the vault.** Grant two agents the same category and they coordinate: a Researcher saves findings, a Writer picks up exactly where it left off — different processes, different vendors, same durable, verifiable context. (That's the name: *Handoff*.)
3. **Scoped, revocable, audited delegation.** A grant is an on-chain object: ONE category, a hard expiry, revocable instantly. An agent can never widen it or outlive it, and every read, write, and denial is recorded on-chain.
4. **Provable deletion (crypto-shredding) — the off switch.** `shred_one` / `shred_all` flip your on-chain policy; from that moment threshold key servers refuse decryption shares for that memory **forever**. The ciphertext can sit on Walrus until the heat-death of the universe — it's cryptographically gone, and the on-chain `Shredded` event is your timestamped, third-party-verifiable proof. That covers *everything in the vault — including what an agent learned about you*. Regulators now demand verifiable erasure from AI providers; Handoff gives it to the user directly. *OpenAI can claim deletion. You can prove it.*

## How it works

```
                       YOUR AI TOOLS (Cursor, Chatbox, any OpenAI-compatible app)
                              │ base_url → <gateway>/capture/v1
                              ▼
            ┌──────────────────────────────┐
            │       Handoff gateway        │  forwards the chat to an LLM (stream or not),
            │                              │  distils durable facts, classifies a category…
            │  embed (FREE local model)    │
            │  Seal-encrypt (id=memoryId) ──────────► Walrus  (ciphertext only)
            │  own vector index            │
            └──────────┬───────────────────┘
                       │ index persisted as a Seal-encrypted manifest on Walrus,
                       │ pointer pinned in your on-chain Vault  → restart-proof, DB-free
                       ▼
        ┌─────────────────────────────────────────┐
        │   Sui: Vault object (YOURS)             │   entry seal_approve(id, vault):
        │   owner · delegates · deleted-table     │     abort if wiped/shredded/uninvited
        │   shred_one / shred_all  → events       │   ← Seal key servers run this LIVE
        └─────────────────────────────────────────┘     before releasing any key share

  RECALL (you, or an agent with a Grant):
    query → embed → cosine over the index → fetch ciphertext from Walrus
    → Seal key servers check seal_approve ON-CHAIN → decrypt → answer.
  REMEMBER (an agent with a Grant):
    finding → written into the ONE granted category, provenance-tagged
    with the agent's name → other agents (and you) can build on it.
  SHRED:
    you sign shred_one(memoryId) → key servers refuse that id forever
    → `Shredded` event = the public proof of deletion.
```

For delegation, a third-party agent holds only a **grant credential**: the gateway verifies an op-bound signature (a recall signature can never authorize a write), reads the on-chain `Grant` (scope, expiry, revoked), checks the grantor actually owns the vault, serves **only the granted category** — read or write — and logs `AccessLogged` on-chain: read, write, or deny.

## Components

| Path | What it is |
|---|---|
| `vault/` | Move package — the **Vault Seal policy**: `seal_approve` (live decryption gate), `shred_one`/`shred_all` (provable deletion), delegates, registry, manifest pointer. **9/9 tests.** |
| `contracts/` | Move package — the **grant registry**: `Grant` objects, `create_grant`/`revoke_grant`, `log_access` (on-chain audit). **5/5 tests.** |
| `proxy/` | The **gateway** (Hono): capture proxy (`/capture/v1`, OpenAI-compatible), the self-Seal memory layer (free local embeddings + own index + Walrus + Seal), owner memory API, and grant enforcement. |
| `dashboard/` | Next.js app — Google sign-in (zkLogin), memory vault UI with **Forget** / **Shred everything**, grants, live on-chain activity incl. **deletion proofs**. Hosts the agent app at `/agent`. |
| `sdk/` · `mcp/` | [`@handoff/sdk`](sdk/README.md) + [`@handoff/mcp`](mcp/README.md) — any agent (or Claude Desktop/Cursor via MCP) gets `recall` + `remember` over its granted slice in a few lines. |

## Security model

- **Decryption is policy-gated, not server-gated.** Every decrypt requires fresh key shares from independent Seal key servers, each of which dry-runs your Vault's `seal_approve` on-chain. The gateway holds *no* decryption keys of its own — it is a *delegate* in your Vault that **you can remove on-chain at any time**.
- **Deletion is cryptographic, not janitorial.** We verified end-to-end on testnet: a memory written, stored on Walrus, decrypted fine → after `shred_one`, the *same ciphertext fetched back from Walrus* fails with "no access to the requested keys" — and other memories still decrypt. `shred_all` kills everything at once. The Move tests pin the invariants (a shredded id is denied even to the owner).
- **Grants can't be forged over someone else's vault.** The gateway denies any grant whose grantor doesn't own the target account (`grantor_not_account_owner`) — covered by an attacker test in `scripts/e2e-superset.mjs`.
- **No database anywhere.** Identity = zkLogin address. Vault discovery = on-chain registry. Index = encrypted manifest on Walrus with an on-chain pointer. Auth = device keys registered on-chain. Kill the gateway and nothing is lost.
- Hardened surface: input validation, payload caps, per-IP rate limits, scoped CORS, security headers; gas-sponsored txs are target-allowlisted.

## Live on Sui testnet

| Thing | Value |
|---|---|
| Vault policy package (Seal + shred) | `0x0064dba2a96c88235564f351307addbe0609180d59e44e03b626e939281d4019` |
| Vault registry | `0x96d44f1911e8127c1f61588089cdf034239f91def3c9f14f34bd280573ecab01` |
| Grant registry package | `0x524cf0a119a759b4b7375bd93cbdbcce480ff3e7791f20f0ec82aa8db05126cb` |
| Seal key servers | Mysten testnet 2-of-2 threshold |
| Storage | Walrus testnet (publisher/aggregator) |

## Run it locally

Prereqs: Node 20.12+, pnpm. Copy `dashboard/.env.example` → `dashboard/.env.local` and fill it in (Google client id + Enoki keys + a free Groq key for the LLM + a `HANDOFF_MASTER_SECRET`). In `proxy/.env` set the **same** `PROXY_DELEGATE_KEY` and `HANDOFF_MASTER_SECRET`, plus the same `LLM_*` values. Embeddings are a free local model by default — no key needed.

```bash
# 1. the gateway — http://localhost:8787
cd proxy && pnpm install && pnpm start

# 2. the app (owner dashboard + agent app) — http://localhost:3000
cd ../dashboard && pnpm install && pnpm dev
```

**Demo flow:**
1. Sign in with Google → your identity + encrypted memory vault are provisioned on Sui (gas sponsored).
2. **Connect your AI tools** → point any OpenAI-compatible tool (or the in-app `curl`) at `<gateway>/capture/v1` and chat about something real — meds, money, plans. Seconds later the facts appear in your vault, encrypted, categorized.
3. **Multi-agent handoff** → one click assembles a Researcher + a Writer on the same category. Give the Researcher a task — watch it *save its findings into your vault* (✍️, provenance-tagged). Open the Writer — it picks up the Researcher's notes and continues. Two agents, zero shared infrastructure, coordinated through *your* vault.
4. Or grant `HealthBot` your `health` category for 1 hour → **Hand to the agent ↗** — it answers from that slice and *only* that slice, and remembers what it learns.
5. **Revoke** → its next read *and* write are denied from chain. Every read/write/deny is in **Activity**.
6. The finale: click **Forget** on any memory — *including one an agent wrote about you* (or **Shred everything**). Watch the deletion proof land on-chain — then try to read the memory again, anywhere. It's gone. *Provably.*

## Tests

```bash
cd vault && sui move test          # Seal policy: access, shred-one, wipe-all, owner-gating (9)
cd ../contracts && sui move test   # grants: validity, revoke, expiry, audit (5)
cd ../sdk && pnpm install && pnpm build
node scripts/e2e-superset.mjs      # live e2e (8 checks): scoped recall · no cross-category leak ·
                                   # agent write-back · op-bound signatures · agent→agent handoff ·
                                   # foreign-vault attacker denied · revoke kills reads AND writes
```

## Why not just build on MemWal / Walrus Memory?

We started there — and hit two walls that define this project:

1. **Provable deletion requires owning the Seal policy — and is architecturally impossible on the managed layer.** Two verifiable facts about the platform's deployed design:
   - Its `seal_approve` derives **one Seal key per account** (`seal_key_id = bcs(owner_address)`): every memory in an account is encrypted to the *same* identity. Per-memory revocation can't exist there — once any party derives the account key, it opens *everything, forever*. (Handoff encrypts each memory to its own random identity, so keys are single-memory and individually revocable.)
   - Its own architecture docs state that account *"deletion … is treated as a deactivation (freezing) rather than true erasure"* — account-level, with no per-memory tombstones and no public erasure proof.

   Crypto-shredding works by making *your own* on-chain `seal_approve` refuse a memory id forever. The off switch only means something if the policy object is yours. So Handoff implements its own Vault policy (`vault/`) and talks to Walrus + Seal directly. (Walrus's native "deletable blobs" don't help either — that's storage reclamation, explicitly non-binding if other copies exist, with no cryptographic guarantee.)
2. **It pushed us to build user-grade controls the SDK doesn't have:** per-memory shredding with public proof, time-boxed third-party grants with on-chain audit of every read/write/denial, agent write-back with provenance, passive capture from any OpenAI-compatible tool, and a no-wallet (zkLogin) consumer app over all of it.

Same thesis as the platform — memory should be portable and verifiable — taken one layer deeper: **verifiable *erasure* and user-side control**, built directly on the primitives.

## Honest limitations / roadmap

- **The gateway sees plaintext in flight.** It decrypts (as your revocable delegate) to serve recalls, and the capture proxy necessarily sees your chats to distil them. You can fire it on-chain at any time, and it stores nothing — but a fully end-to-end version would decrypt client-side via the same `seal_approve` (the policy already supports it; it's a client build, not a protocol change).
- **Scope enforcement for grants lives in the gateway** (the Vault policy gates *who*, not yet *which category*). Next step: `seal_approve` that also accepts a valid on-chain `Grant` for the matching namespace — then even the gateway can't over-share. The contract surface is designed for it.
- **Testnet economics.** Walrus blobs are paid for ~5 epochs on testnet; production needs renewal or longer leases.

## License

MIT
