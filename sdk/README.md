# @handoff/sdk

Let any AI agent consume a **Handoff grant** — scoped, revocable, just-in-time access to a slice of a user's memory.

The agent holds only a credential (`grantId` + Ed25519 key). It never gets a copy of the user's memory; it pulls the one granted slice through the Handoff gateway, which enforces scope, expiry and revocation from chain on every call.

## Install

```bash
pnpm add @handoff/sdk   # or: npm i @handoff/sdk
```

## Use

```ts
import { HandoffClient } from "@handoff/sdk";

const handoff = new HandoffClient({
  credential: { grantId: "0x…", credentialPrivateKey: "…" }, // shared by the user
  gatewayUrl: "https://your-gateway.example",                 // defaults to localhost:8787
});

// What am I allowed to see?
const terms = await handoff.terms();
// → { granteeLabel: "ShopBot", namespace: "shopping", status: "active", expiresAt, … }

// Pull scoped memory just-in-time
const r = await handoff.recall("running shoes");
if (r.allowed) {
  console.log(r.results.map((m) => m.text)); // only the granted "shopping" slice
} else {
  console.log("denied:", r.reason); // e.g. grant_revoked / grant_expired
}

// Save a finding back into the SAME slice — so the agent (and other agents the
// user authorizes on this category) can build on it next session. The write is
// provenance-tagged with this agent's name; the user can shred it with proof.
const w = await handoff.remember("The user chose the Pegasus 41 in size 10.");
if (w.allowed) console.log("saved:", w.memId);
```

Or load the credential from the environment:

```ts
import { clientFromEnv } from "@handoff/sdk";
// HANDOFF_GRANT_ID, HANDOFF_CREDENTIAL_KEY, HANDOFF_GATEWAY_URL
const handoff = clientFromEnv();
```

## Guarantees

- **Scoped** — read AND write touch only the granted category, never anything else.
- **Time-boxed** — access ends at the grant's expiry.
- **Revocable** — the user can revoke on-chain; the next call is denied.
- **Audited** — every read, write, and denial is recorded on-chain as an `AccessLogged` event.
- **Op-bound signatures** — a recall signature can never authorize a write (and vice versa).
- **Shreddable** — anything the agent writes, the user can crypto-shred with on-chain proof.
