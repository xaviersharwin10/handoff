# How Handoff Works — The Complete Explanation

This document explains the entire product from zero. It assumes you know nothing about
blockchains, AI infrastructure, or cryptography. Every term is defined before it's used.
Read it top to bottom once, and you'll understand every moving part of Handoff.

---

## The product in one paragraph

Handoff gives AI a long-term memory of you that **you own**. Your chats with AI are
automatically distilled into durable facts ("the user is vegan", "the user takes 50mg
sertraline daily"), each fact is locked with encryption that only rules *you* control can
open, and stored on a public, decentralized network. AI agents you authorize can read —
and write — exactly one slice of that memory, for a limited time, revocably, with every
access publicly logged. And the headline feature: when you delete a memory, it becomes
**mathematically unreadable forever**, and you get a **public, timestamped proof** that the
deletion happened — something no AI company offers.

---

# Part I — The building blocks

Before explaining Handoff, you need to know what its ingredients are. Each section below
is: *what the thing is*, then *why Handoff uses it*.

## 1. LLMs (the "AI" everyone talks about)

**What it is:** A Large Language Model — the engine behind ChatGPT, Claude, Gemini. You
send it text, it sends back text. Crucially, an LLM is **stateless**: it has no memory of
you. Every request starts from zero. When ChatGPT "remembers" you, that's not the model —
that's OpenAI's *database* quietly saving notes about you and pasting them into future
requests.

**Why Handoff cares:** That database is the problem Handoff solves. The model can stay
anyone's (we currently use a free one called Llama, hosted by a company called Groq — it's
one configuration line to swap it for OpenAI, Claude, or a model running on your own
computer). Handoff replaces the *database*: the notes about you go into your vault instead
of a company's servers.

## 2. Embeddings (how computers search by meaning)

**What it is:** An embedding model turns a sentence into a list of numbers (a "vector") —
in our case 384 numbers — such that sentences with similar *meaning* get similar numbers.
"What medication do I take?" and "The user takes 50mg sertraline daily" land close
together as numbers even though they share almost no words. Comparing two vectors is one
multiplication (called *cosine similarity*); higher = more related.

**Why Handoff cares:** This is how memory search works. When you (or an agent) ask a
question, we embed the question, compare it against the embeddings of all your memories,
and the closest ones are the relevant memories. Handoff runs a small free embedding model
(MiniLM) **inside our own gateway** — no external service ever sees your text just to
index it, and it costs nothing.

## 3. Blockchains, and Sui specifically

**What it is:** A blockchain is a public computer that nobody owns. Thousands of
independent machines run the same programs and keep the same records, so the records
can't be secretly altered, deleted, or faked by any single company — including the one
that wrote the program. Everything written to it is timestamped and publicly auditable.

**Sui** is the specific blockchain Handoff uses. Two Sui concepts matter here:

- **Objects.** On Sui, data lives in typed *objects* with owners. Your Handoff vault is
  an object. Each permission you grant an agent is an object. Objects can only be changed
  according to the rules in the program that created them.
- **Move.** The programming language for those rules. A Move program (called a *package*
  or *smart contract*) is published once and then runs exactly as written — *we* cannot
  change how your vault behaves after the fact.
- **Events.** A Move program can emit permanent public log entries. Handoff uses events
  as its audit trail and as deletion proofs.
- **Gas.** Every change on a blockchain costs a tiny fee, called gas. (See "sponsored
  transactions" below for why you never pay it.)

**Why Handoff cares:** The chain is Handoff's *rulebook and notary*. Who owns the vault,
who's allowed to decrypt, what's been deleted, who accessed what and when — all of that
lives on Sui, where neither Handoff nor anyone else can quietly rewrite it.

## 4. zkLogin and sponsored transactions (why there's no crypto homework)

**What it is:** Normally, using a blockchain requires a *wallet* — an app holding a secret
key, with a 12-word recovery phrase you must never lose. That kills mainstream usability.
**zkLogin** is a Sui feature that turns a normal "Sign in with Google" into a blockchain
identity: a mathematical proof (a *zero-knowledge proof*) shows you control the Google
account, without Google learning what you do on-chain and without you managing any keys.
**Sponsored transactions** mean someone else (Handoff, via a service called Enoki) pays
the gas fees for your actions.

**Why Handoff cares:** Your grandmother can use this. Google sign-in, no wallet, no fees,
no seed phrase — yet underneath, she owns a real on-chain vault.

## 5. Walrus (where the actual data lives)

**What it is:** Blockchains are terrible at storing *files* — they're built for small
records, and storing megabytes on-chain is absurdly expensive. **Walrus** is a
decentralized *storage* network built alongside Sui: you hand it a *blob* (any chunk of
bytes), it splits the blob into redundant fragments spread across many independent
storage nodes, and gives you back a **blob ID** — a fingerprint with which anyone can
fetch the bytes back from the network. No single company holds your data; no single
node failure loses it.

**Why Handoff cares:** Every encrypted memory is a blob on Walrus. So is the encrypted
index (more later). Handoff's servers store *nothing* — if Handoff vanished tomorrow,
your encrypted data is still sitting on Walrus, and your rules for unlocking it are
still on Sui.

> Important nuance: Walrus is **public**. Anyone can fetch your blobs. That's fine —
> what they fetch is ciphertext (encrypted noise). The security lives entirely in *who
> can decrypt*, which is the next section.

## 6. Seal (the lock on every memory) — the most important ingredient

**What it is:** Normally, encryption works like this: data is locked with a key, and
whoever holds the key can unlock it, forever. The hard problem is: *where do you keep the
key?* If Handoff kept it, you'd be trusting Handoff — back to square one.

**Seal** solves this differently, with two ideas:

1. **Identity-based encryption (IBE).** You can encrypt data "to a name" — any label you
   invent — without a key for that name existing yet. The key for a given name can be
   *derived later*, on demand, by special servers. Handoff encrypts every memory to a
   unique random name (its **memory ID**).
2. **Threshold key servers governed by YOUR on-chain rules.** The servers that derive keys
   (run by Mysten Labs, *not* by Handoff) will only do it if a Move function called
   `seal_approve` — *in the program that the encryptor chose, executed live on the Sui
   blockchain* — says yes. And it takes **two independent servers agreeing** (a 2-of-2
   *threshold*) to assemble a working key, so no single server can go rogue.

Think of it as: every memory is a safe-deposit box, and the locksmiths who can cut keys
are independent professionals who, before every single cut, must walk over to a public
courthouse (Sui) and check the rulebook *you* published (your Vault's `seal_approve`
rules). If the rulebook says no, no key gets cut. Nobody — not Handoff, not the
locksmiths individually — can bypass the courthouse.

Handoff wrote its own rulebook (the **Vault** Move package). Its `seal_approve` says,
in plain English:

> Cut a key for memory X **only if**: the vault hasn't been wiped, memory X isn't on the
> deleted list, and the person asking is the vault's owner or one of the owner's
> appointed delegates.

**Why Handoff cares:** This is what makes the product's promises *enforceable* instead of
*claimed*. Access control isn't a row in our database — it's your on-chain object,
checked by outside parties on every decryption.

## 7. Crypto-shredding (how deletion becomes provable)

**What it is:** A technique with a blunt insight: you don't need to erase encrypted data —
you need to destroy the *ability to decrypt it*. Encrypted data without its key is,
mathematically, random noise. Enterprises use this for GDPR ("right to be forgotten")
compliance; regulators have begun demanding *verifiable proof of erasure* from AI
providers.

**How Handoff does it:** When you click **Forget**, a transaction adds that memory's ID to
your vault's on-chain `deleted` table and emits a public `Shredded` event. From that
block onward, `seal_approve` aborts for that ID → the key servers refuse to derive its
key → **forever**. The ciphertext can sit on Walrus until the end of time; it's noise.
The `Shredded` event — public, timestamped, on a blockchain — is your proof. **Shred
everything** does the same with one flag (`wiped_all`) covering the whole vault.

No company's "we deleted your data, trust us" can offer this, because their deletion
happens in private infrastructure you can't inspect. Ours happens in public rules you
can.

## 8. Smaller ingredients, quickly

- **Ed25519 keys** — a standard type of cryptographic keypair (a private key that signs,
  a public key that verifies). Handoff uses them for *device keys* (your browser proves
  it's you) and *grant credentials* (an agent proves it holds a grant). A signature
  proves "the holder of this key approved this exact message" — unforgeable, verifiable
  by anyone with the public key.
- **OpenAI-compatible API** — the de-facto standard way apps talk to LLMs: a "base URL"
  plus an API key. Dozens of apps (Cursor, Chatbox, etc.) let you change the base URL,
  which is how they can be pointed at Handoff's gateway.
- **MCP (Model Context Protocol)** — a standard that lets AI apps like Claude Desktop be
  given *tools*. Handoff ships an MCP server, so a Claude Desktop agent natively gets
  `recall_memory` / `remember_memory` tools backed by a grant.

---

# Part II — The pieces of Handoff

| Piece | What it is | What it does |
|---|---|---|
| **Dashboard** (`dashboard/`) | The website you use | Sign-in, vault setup, built-in chat, memory list/search, granting agents, revoking, shredding, viewing the audit trail and deletion proofs |
| **Agent app** (`dashboard/app/agent`) | A separate workspace page | Where a third-party agent (with only a credential) chats, reads its granted slice, and saves findings back |
| **Gateway** (`proxy/`) | One always-on server | The worker: forwards chats to the LLM, distills facts, embeds, encrypts, talks to Walrus, runs memory search, enforces grants, writes audit events. Holds **no data and no master keys** |
| **Vault package** (`vault/`) | A Move program on Sui | Your vault object: owner, delegates, deleted-list, manifest pointer; `seal_approve` (the decryption rulebook); `shred_one` / `shred_all` (provable deletion) |
| **Grants package** (`contracts/`) | A Move program on Sui | Grant objects (scope/expiry/revoked + the agent's public key) and `log_access` (the on-chain audit log) |
| **SDK** (`sdk/`) | A code library | Lets any developer's agent use a grant: `terms()`, `recall()`, `remember()` in three lines |
| **MCP server** (`mcp/`) | A small adapter | Gives Claude Desktop / Cursor agents the same powers as native tools |

Two more parties that are **not us**:

- **Seal key servers** (Mysten Labs): derive decryption keys, only after checking your
  vault's rules on-chain. Two must agree.
- **Walrus storage nodes** (independent operators): hold the encrypted blobs.

---

# Part III — What actually happens, step by step

## A. You sign up (one time, ~30 seconds)

1. You click "Continue with Google". zkLogin converts that into a Sui address — your
   on-chain identity. No wallet, no phrase.
2. The setup screen runs three sponsored (free-to-you) transactions:
   - **Register this device.** Your browser generates a device keypair and registers its
     public key on-chain. From now on your browser *signs* every owner action, and the
     gateway verifies the signature against the chain — no passwords, no sessions, no
     user database.
   - **Create your Vault** — the on-chain object from Part I §6.
   - **Appoint the gateway as a delegate** in your vault — this is what lets the gateway
     decrypt on your behalf to serve you. It's a standing appointment **you can revoke
     on-chain at any time**, instantly stripping the gateway of all decryption ability.

## B. You chat, and memory appears (the write path)

You type into the built-in chat: *"I take 50mg sertraline daily and I'm training for the
Chennai marathon."*

1. Your browser sends the chat to the gateway with a **capture token** (an unforgeable
   pass derived from a secret + your account ID — it can only *add* memories to *your*
   vault, nothing else).
2. The gateway forwards the chat to the LLM and streams the reply back to you, untouched.
3. *In the background*, the gateway asks the LLM a second question: "What in this exchange
   is a durable fact worth remembering? Classify each into a category." Answer: two facts,
   `health` and `travel`. Greetings and small talk produce nothing.
4. For each fact:
   - generate a random **memory ID**;
   - **embed** the text into its 384-number meaning-vector (locally, free);
   - **Seal-encrypt** the text *to that memory ID* under your vault's rulebook;
   - upload the ciphertext to **Walrus** → get a blob ID;
   - add one line to your vault's **index**: `{memory ID, category, vector, blob ID,
     time, source}`. ("Source" records who wrote it: you, auto-capture, or an agent's name.)
5. A few seconds later (debounced), the gateway encrypts the *entire index* as one blob
   ("the manifest"), uploads it to Walrus, and writes the manifest's blob ID into your
   on-chain Vault. This is why there is **no database**: the index itself lives encrypted
   on Walrus with its address pinned on-chain.

The same pipeline serves every other entrance: a connected tool (Cursor/Chatbox), your
manual "Remember" box, and agents writing through grants.

## C. You search your memory (the read path)

You ask: *"what medication do I take?"*

1. Your browser signs the request with your device key; the gateway checks the signature
   against your on-chain delegate list.
2. The gateway embeds your question and compares it against your index's vectors —
   closest matches win.
3. For each match, the gateway fetches the ciphertext from Walrus, then performs the Seal
   ritual: it presents the `seal_approve(memoryID, yourVault)` check to **both key
   servers**; each one *executes your vault's rules on Sui, live*; if the memory isn't
   shredded and the gateway is still your delegate, both return their key shares, the
   memory decrypts, and you get your answer.
4. If a memory was shredded by another device meanwhile, the key servers refuse, and the
   gateway drops it from the index on the spot. **The chain, not the index, is the truth.**

## D. You authorize an agent (grants)

You grant "Researcher" your `travel` category for 24 hours:

1. Your **browser** generates a fresh Ed25519 keypair for the agent. The private key is
   shown once, to you — our servers never see it.
2. A sponsored transaction creates a **Grant object** on Sui containing: your account,
   the category (`travel`), the agent's label, the **public** key, and the expiry time.
3. You hand the credential (grant ID + private key) to the agent — by opening our hosted
   agent workspace, or by pasting it into any agent built on our SDK/MCP.

When the agent wants to read, it signs `handoff.recall|grantID|question|timestamp` with
its private key and calls the gateway, which checks **five gates, in order**:

1. **Freshness** — the timestamp must be recent (stops replaying old requests).
2. **The Grant, read from chain** — not revoked, not expired. (Not from any cache or
   database: from Sui, every time.)
3. **Ownership** — the person who created the grant must actually own the vault it points
   at (otherwise a stranger could mint themselves a grant over *your* vault — we tested
   this attack; it's denied).
4. **The signature** — verified against the Grant's on-chain public key. Signatures are
   **operation-bound**: a signature for reading can never be replayed to authorize a
   write, and vice versa.
5. **Scope** — the search is pinned to the Grant's category. The agent cannot ask for
   another category; the parameter doesn't exist for it.

Writing works the same way (`handoff.remember|…`): the fact is stored in the granted
category, **provenance-tagged with the agent's name** — so your vault shows "by
Researcher" on everything it wrote, and you can shred any of it.

**Every decision — read allowed, write allowed, or denial with its reason — is written to
Sui as an `AccessLogged` event.** That's the Activity feed: not our logs, public ones.

## E. Agents hand work to each other

Grant two agents the same category, and coordination falls out for free: the Researcher
saves findings into `travel`; the Writer's recall over `travel` surfaces them (tagged "by
Researcher"); the Writer builds on them. Two agents, possibly built by different people
on different stacks, sharing durable context **through your vault, on your terms** —
both revocable in one click, both fully audited. That's the product's namesake.

## F. You delete — provably

Click **Forget** on any memory (including one an agent wrote about you):

1. A sponsored transaction calls `shred_one(vault, memoryID)`: the ID goes into your
   vault's on-chain deleted-table, and a public **`Shredded` event** is emitted.
2. From that moment, `seal_approve` aborts for that ID, both key servers refuse to ever
   derive its key again, and the ciphertext on Walrus is permanent noise. There is no
   undo, no backup, no admin override — *by construction*, not by policy.
3. The Activity panel shows the deletion proof with a link to the transaction on a public
   Sui explorer. Anyone — an auditor, a regulator, a skeptical friend — can verify it
   without trusting you or us.

**Shred everything** is the same, vault-wide, in one transaction.

## G. If Handoff's server dies (the no-database guarantee)

Start a fresh gateway anywhere with the delegate key: it reads your Vault on Sui → finds
the manifest pointer → fetches the encrypted index from Walrus → asks the key servers to
decrypt it (the chain still says it's your delegate) → serves your memory again. Shredded
memories stay dead, because the tombstones live on-chain. We've tested this restart path
end to end. There is no backup to lose, no database to breach, no migration to run.

---

# Part IV — Security model: who can do what

| Actor | Can | Cannot |
|---|---|---|
| **You** (owner) | read everything, grant, revoke, shred, fire the gateway | un-shred (nobody can) |
| **The gateway** | decrypt *while* it's your delegate; sees chat text in flight | read anything after you remove it on-chain; recover shredded data; act without leaving on-chain evidence |
| **An agent with a grant** | read + write ONE category until expiry/revoke | widen scope, outlive the grant, forge the other operation, touch another vault |
| **A Seal key server** | refuse service | decrypt alone (threshold), ignore your on-chain rules |
| **Walrus nodes / the public** | fetch ciphertext | decrypt anything |
| **Handoff, the company** | run the gateway | reach your memory without being your on-chain delegate; resurrect shredded data; rewrite the audit log |

### The three honest limitations (also in the README)

1. **The gateway sees plaintext in flight.** It must — to distill chats and serve
   recalls. It stores nothing and is fire-able on-chain, but while trusted it could, if
   malicious, observe traffic. The endgame is decryption *in your browser* (the on-chain
   rulebook already permits the owner directly; it's a client build, not a redesign).
2. **Grant scoping is enforced by the gateway**, not yet by the chain (the chain gates
   *who* may decrypt; the gateway pins *which category*). Phase 2 is a `seal_approve`
   that also validates a live Grant on-chain, making even the gateway unable to over-share.
3. **The upstream LLM sees each message once** — stateless, with no account or identity
   of yours attached (the gateway calls it with its own key, from its own server). What
   Handoff eliminates is the *accumulated profile*; what no proxy can eliminate is the
   model momentarily reading the words it answers.

---

# FAQ

**Is Handoff an LLM / a ChatGPT competitor?**
No. The "brain" is whichever model the gateway points at (currently a free one; swappable
in one line — including a local model for total privacy). Handoff is the **memory layer**
underneath: the part that persists, that's owned, scoped, lendable, and provably erasable.

**Do users need to buy API keys?**
No. The built-in chat requires nothing. The "connection key" for power users' own tools
is a free token Handoff mints; the LLM bill is the gateway operator's (free tier today).

**What's publicly visible on the blockchain?**
Object ownership, delegate addresses, grant terms (category *name*, label, expiry),
access decisions (allowed/denied, counts), and deletion events. **Never memory content**
— content exists only as Walrus ciphertext, and queries are deliberately kept off-chain.

**What if Walrus or the key servers disappear?**
Walrus blobs survive node failures by design (redundant fragments). The key servers are
the availability dependency for *decryption* — if all of them vanished, decryption (by
anyone) would halt; testnet runs two, production Seal supports larger committees you can
choose. Note the asymmetry: their failure can deny access, but can never *grant* it.

**Why blockchain at all? Couldn't a normal company do this?**
A normal company can *promise* all of this. It cannot *prove* any of it: you can't verify
their deletion, audit their access log, or survive their bankruptcy. Handoff's rules are
public code on a network nobody (including Handoff) controls — the difference between a
pinky promise and a notarized contract that executes itself.
