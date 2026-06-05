/// Handoff — on-chain grant registry.
///
/// A `Grant` records permission for a third-party agent to access ONE slice
/// (namespace) of a MemWal account, until an expiry, revocable by the grantor.
/// The Handoff proxy reads these grants to enforce scoped, time-boxed, auditable
/// access on top of MemWal's all-or-nothing delegate keys.
module handoff::grants;

use std::string::{Self, String};
use sui::clock::Clock;
use sui::event;

/// Caller is not the grantor of this grant.
const ENotGrantor: u64 = 0;

/// A scoped, time-boxed, revocable permission. Shared so the proxy can read it
/// by id over RPC and the grantor can revoke it.
public struct Grant has key, store {
    id: UID,
    /// Who issued the grant (the memory owner).
    grantor: address,
    /// The MemWalAccount object id this grant scopes (as address).
    memwal_account: address,
    /// The single memory slice (MemWal namespace) this grant exposes.
    namespace: String,
    /// Human-readable label for the grantee, e.g. "ShopBot".
    grantee_label: String,
    /// Ed25519 public key of the grant credential. The proxy verifies that the
    /// caller signs with the matching private key before honoring the grant.
    grantee_pubkey: vector<u8>,
    created_at: u64,
    /// Epoch ms after which the grant is no longer valid.
    expires_at: u64,
    revoked: bool,
}

public struct GrantCreated has copy, drop {
    grant_id: ID,
    grantor: address,
    memwal_account: address,
    namespace: String,
    grantee_label: String,
    expires_at: u64,
}

public struct GrantRevoked has copy, drop {
    grant_id: ID,
    grantor: address,
    revoked_at: u64,
}

fun clone_string(s: &String): String {
    string::utf8(*s.as_bytes())
}

/// Issue a new grant. `ttl_ms` is the lifetime from now; access ends at
/// `now + ttl_ms`. The grant is shared so the proxy can read it and the
/// grantor can later revoke it.
public fun create_grant(
    memwal_account: address,
    namespace: String,
    grantee_label: String,
    grantee_pubkey: vector<u8>,
    ttl_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let now = clock.timestamp_ms();
    let grant = Grant {
        id: object::new(ctx),
        grantor: ctx.sender(),
        memwal_account,
        namespace,
        grantee_label,
        grantee_pubkey,
        created_at: now,
        expires_at: now + ttl_ms,
        revoked: false,
    };

    event::emit(GrantCreated {
        grant_id: object::id(&grant),
        grantor: grant.grantor,
        memwal_account: grant.memwal_account,
        namespace: clone_string(&grant.namespace),
        grantee_label: clone_string(&grant.grantee_label),
        expires_at: grant.expires_at,
    });

    transfer::share_object(grant);
}

/// Revoke a grant immediately. Only the original grantor may revoke.
public fun revoke_grant(grant: &mut Grant, clock: &Clock, ctx: &TxContext) {
    assert!(grant.grantor == ctx.sender(), ENotGrantor);
    grant.revoked = true;
    event::emit(GrantRevoked {
        grant_id: object::id(grant),
        grantor: grant.grantor,
        revoked_at: clock.timestamp_ms(),
    });
}

// ---- read-only accessors (handy for PTBs/tests; the proxy reads fields via RPC) ----

/// True if the grant is currently usable (not revoked and not expired).
public fun is_valid(grant: &Grant, clock: &Clock): bool {
    !grant.revoked && clock.timestamp_ms() < grant.expires_at
}

public fun grantor(grant: &Grant): address { grant.grantor }

public fun memwal_account(grant: &Grant): address { grant.memwal_account }

public fun namespace(grant: &Grant): &String { &grant.namespace }

public fun grantee_pubkey(grant: &Grant): &vector<u8> { &grant.grantee_pubkey }

public fun expires_at(grant: &Grant): u64 { grant.expires_at }

public fun is_revoked(grant: &Grant): bool { grant.revoked }
