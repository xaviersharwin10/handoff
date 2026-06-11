/// Handoff memory vault — the on-chain access + deletion policy for a user's
/// Seal-encrypted memories (stored on Walrus, indexed off-chain by the gateway).
///
/// Seal key servers run `seal_approve` live (as a dry-run) before releasing
/// decryption key shares:
///   - decryption is allowed only for the owner or a registered delegate (the
///     Handoff gateway), only while the vault isn't wiped, and only while THIS
///     memory id hasn't been shredded.
///   - `shred_one` makes a single memory permanently undecryptable; `shred_all`
///     kills the whole vault. Both emit events — the on-chain, timestamped PROOF
///     of deletion. The encrypted blob can persist on Walrus forever; without
///     key shares it is cryptographically gone.
///
/// A shared `Registry` maps owner address → vault id so any client can discover
/// a user's vault from chain alone (no database).
module handoff_vault::vault;

use sui::event;
use sui::table::{Self, Table};

/// Not the owner or a delegate / vault wiped / this memory was shredded.
const ENoAccess: u64 = 0;
/// Only the owner may perform this action.
const ENotOwner: u64 = 1;
/// This owner already has a vault.
const EVaultExists: u64 = 2;

public struct Registry has key {
    id: UID,
    /// owner address → Vault object id
    vaults: Table<address, ID>,
}

public struct Vault has key {
    id: UID,
    owner: address,
    /// Keys allowed to decrypt on the owner's behalf (e.g. the Handoff gateway).
    delegates: vector<address>,
    /// True once the whole vault has been shredded.
    wiped_all: bool,
    /// memoryId (Seal identity bytes) → shredded.
    deleted: Table<vector<u8>, bool>,
    /// Walrus blobId (utf8) of the current encrypted index manifest; empty if none.
    manifest: vector<u8>,
}

public struct VaultCreated has copy, drop { vault: ID, owner: address }
public struct Shredded has copy, drop { vault: ID, memory_id: vector<u8>, owner: address }
public struct WipedAll has copy, drop { vault: ID, owner: address }

fun init(ctx: &mut TxContext) {
    transfer::share_object(Registry { id: object::new(ctx), vaults: table::new(ctx) });
}

/// Create a vault owned by the caller and register it (shared so Seal key
/// servers can read it). One vault per owner.
public fun create(registry: &mut Registry, ctx: &mut TxContext) {
    let owner = ctx.sender();
    assert!(!table::contains(&registry.vaults, owner), EVaultExists);
    let vault = Vault {
        id: object::new(ctx),
        owner,
        delegates: vector[],
        wiped_all: false,
        deleted: table::new(ctx),
        manifest: vector[],
    };
    table::add(&mut registry.vaults, owner, object::id(&vault));
    event::emit(VaultCreated { vault: object::id(&vault), owner });
    transfer::share_object(vault);
}

/// Authorize a key (e.g. the gateway) to decrypt on the owner's behalf.
public fun add_delegate(vault: &mut Vault, who: address, ctx: &TxContext) {
    assert!(ctx.sender() == vault.owner, ENotOwner);
    if (!vault.delegates.contains(&who)) vault.delegates.push_back(who);
}

/// Remove a delegate (e.g. fire the gateway).
public fun remove_delegate(vault: &mut Vault, who: address, ctx: &TxContext) {
    assert!(ctx.sender() == vault.owner, ENotOwner);
    let (found, i) = vault.delegates.index_of(&who);
    if (found) { vault.delegates.swap_remove(i); };
}

/// Record the current encrypted index manifest pointer (owner or delegate).
public fun set_manifest(vault: &mut Vault, blob_id: vector<u8>, ctx: &TxContext) {
    let s = ctx.sender();
    assert!(s == vault.owner || vault.delegates.contains(&s), ENoAccess);
    vault.manifest = blob_id;
}

/// SEAL policy — checked live by the key servers before releasing a key share.
entry fun seal_approve(id: vector<u8>, vault: &Vault, ctx: &TxContext) {
    assert!(!vault.wiped_all, ENoAccess);
    assert!(!table::contains(&vault.deleted, id), ENoAccess);
    let s = ctx.sender();
    assert!(s == vault.owner || vault.delegates.contains(&s), ENoAccess);
}

/// Provably delete ONE memory: it can never be decrypted again.
public fun shred_one(vault: &mut Vault, memory_id: vector<u8>, ctx: &TxContext) {
    assert!(ctx.sender() == vault.owner, ENotOwner);
    if (!table::contains(&vault.deleted, memory_id)) {
        table::add(&mut vault.deleted, memory_id, true);
    };
    event::emit(Shredded { vault: object::id(vault), memory_id, owner: vault.owner });
}

/// Provably delete EVERYTHING in the vault (panic button). Irreversible.
public fun shred_all(vault: &mut Vault, ctx: &TxContext) {
    assert!(ctx.sender() == vault.owner, ENotOwner);
    vault.wiped_all = true;
    event::emit(WipedAll { vault: object::id(vault), owner: vault.owner });
}

// ---- read-only accessors ----

public fun is_wiped(vault: &Vault): bool { vault.wiped_all }
public fun is_deleted(vault: &Vault, id: vector<u8>): bool { table::contains(&vault.deleted, id) }
public fun owner(vault: &Vault): address { vault.owner }
public fun manifest(vault: &Vault): &vector<u8> { &vault.manifest }
public fun is_delegate(vault: &Vault, who: address): bool { vault.delegates.contains(&who) }

#[test_only]
public fun registry_for_testing(ctx: &mut TxContext) { init(ctx) }
