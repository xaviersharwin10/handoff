#[test_only]
module handoff_vault::vault_tests;

use sui::test_scenario::{Self as ts};
use handoff_vault::vault::{Self, Registry, Vault};

const OWNER: address = @0xA11CE;
const GATEWAY: address = @0x6A7E;
const STRANGER: address = @0xB0B;

fun mem_id(): vector<u8> { b"memory-0001" }

fun setup(sc: &mut ts::Scenario) {
    vault::registry_for_testing(ts::ctx(sc));
    ts::next_tx(sc, OWNER);
    let mut reg = ts::take_shared<Registry>(sc);
    vault::create(&mut reg, ts::ctx(sc));
    ts::return_shared(reg);
}

#[test]
fun create_and_delegate() {
    let mut sc = ts::begin(OWNER);
    setup(&mut sc);

    ts::next_tx(&mut sc, OWNER);
    let mut v = ts::take_shared<Vault>(&sc);
    assert!(vault::owner(&v) == OWNER, 0);
    assert!(!vault::is_wiped(&v), 1);
    vault::add_delegate(&mut v, GATEWAY, ts::ctx(&mut sc));
    assert!(vault::is_delegate(&v, GATEWAY), 2);
    ts::return_shared(v);
    ts::end(sc);
}

#[test]
#[expected_failure]
fun second_vault_for_same_owner_aborts() {
    let mut sc = ts::begin(OWNER);
    setup(&mut sc);
    ts::next_tx(&mut sc, OWNER);
    let mut reg = ts::take_shared<Registry>(&sc);
    vault::create(&mut reg, ts::ctx(&mut sc)); // EVaultExists
    ts::return_shared(reg);
    ts::end(sc);
}

#[test]
fun seal_approve_owner_and_delegate_allowed() {
    let mut sc = ts::begin(OWNER);
    setup(&mut sc);
    ts::next_tx(&mut sc, OWNER);
    let mut v = ts::take_shared<Vault>(&sc);
    vault::add_delegate(&mut v, GATEWAY, ts::ctx(&mut sc));
    // owner
    vault::seal_approve(mem_id(), &v, ts::ctx(&mut sc));
    ts::return_shared(v);
    // delegate
    ts::next_tx(&mut sc, GATEWAY);
    let v2 = ts::take_shared<Vault>(&sc);
    vault::seal_approve(mem_id(), &v2, ts::ctx(&mut sc));
    ts::return_shared(v2);
    ts::end(sc);
}

#[test]
#[expected_failure]
fun seal_approve_stranger_denied() {
    let mut sc = ts::begin(OWNER);
    setup(&mut sc);
    ts::next_tx(&mut sc, STRANGER);
    let v = ts::take_shared<Vault>(&sc);
    vault::seal_approve(mem_id(), &v, ts::ctx(&mut sc)); // ENoAccess
    ts::return_shared(v);
    ts::end(sc);
}

#[test]
#[expected_failure]
fun seal_approve_denied_after_shred_one() {
    let mut sc = ts::begin(OWNER);
    setup(&mut sc);
    ts::next_tx(&mut sc, OWNER);
    let mut v = ts::take_shared<Vault>(&sc);
    vault::shred_one(&mut v, mem_id(), ts::ctx(&mut sc));
    assert!(vault::is_deleted(&v, mem_id()), 0);
    vault::seal_approve(mem_id(), &v, ts::ctx(&mut sc)); // ENoAccess — even for owner
    ts::return_shared(v);
    ts::end(sc);
}

#[test]
fun shred_one_leaves_other_memories_decryptable() {
    let mut sc = ts::begin(OWNER);
    setup(&mut sc);
    ts::next_tx(&mut sc, OWNER);
    let mut v = ts::take_shared<Vault>(&sc);
    vault::shred_one(&mut v, mem_id(), ts::ctx(&mut sc));
    // a different memory id still approves
    vault::seal_approve(b"memory-0002", &v, ts::ctx(&mut sc));
    ts::return_shared(v);
    ts::end(sc);
}

#[test]
#[expected_failure]
fun seal_approve_denied_after_shred_all() {
    let mut sc = ts::begin(OWNER);
    setup(&mut sc);
    ts::next_tx(&mut sc, OWNER);
    let mut v = ts::take_shared<Vault>(&sc);
    vault::shred_all(&mut v, ts::ctx(&mut sc));
    assert!(vault::is_wiped(&v), 0);
    vault::seal_approve(b"memory-9999", &v, ts::ctx(&mut sc)); // ENoAccess for any id
    ts::return_shared(v);
    ts::end(sc);
}

#[test]
#[expected_failure]
fun only_owner_can_shred() {
    let mut sc = ts::begin(OWNER);
    setup(&mut sc);
    ts::next_tx(&mut sc, STRANGER);
    let mut v = ts::take_shared<Vault>(&sc);
    vault::shred_all(&mut v, ts::ctx(&mut sc)); // ENotOwner
    ts::return_shared(v);
    ts::end(sc);
}

#[test]
fun manifest_set_by_owner_or_delegate() {
    let mut sc = ts::begin(OWNER);
    setup(&mut sc);
    ts::next_tx(&mut sc, OWNER);
    let mut v = ts::take_shared<Vault>(&sc);
    vault::add_delegate(&mut v, GATEWAY, ts::ctx(&mut sc));
    vault::set_manifest(&mut v, b"blob-1", ts::ctx(&mut sc));
    ts::return_shared(v);

    ts::next_tx(&mut sc, GATEWAY);
    let mut v2 = ts::take_shared<Vault>(&sc);
    vault::set_manifest(&mut v2, b"blob-2", ts::ctx(&mut sc));
    assert!(*vault::manifest(&v2) == b"blob-2", 0);
    ts::return_shared(v2);
    ts::end(sc);
}
