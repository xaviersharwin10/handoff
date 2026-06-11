#[test_only]
module handoff::grants_tests;

use sui::test_scenario::{Self as ts};
use sui::clock;
use std::string;
use handoff::grants::{Self, Grant};

const OWNER: address = @0xA11CE;
const OTHER: address = @0xB0B;
const ACC: address = @0xACC0;

fun pk(): vector<u8> { b"0123456789abcdef0123456789abcdef" } // 32 bytes

#[test]
fun create_grant_is_valid_and_scoped() {
    let mut sc = ts::begin(OWNER);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clock::set_for_testing(&mut clk, 1_000);

    grants::create_grant(ACC, string::utf8(b"shopping"), string::utf8(b"ShopBot"), pk(), 60_000, &clk, ts::ctx(&mut sc));

    ts::next_tx(&mut sc, OWNER);
    let g = ts::take_shared<Grant>(&sc);
    assert!(grants::is_valid(&g, &clk), 0);
    assert!(grants::grantor(&g) == OWNER, 1);
    assert!(grants::memwal_account(&g) == ACC, 2);
    assert!(*grants::namespace(&g) == string::utf8(b"shopping"), 3);
    assert!(grants::expires_at(&g) == 61_000, 4);
    assert!(!grants::is_revoked(&g), 5);
    ts::return_shared(g);

    clock::destroy_for_testing(clk);
    ts::end(sc);
}

#[test]
fun revoke_makes_invalid() {
    let mut sc = ts::begin(OWNER);
    let clk = clock::create_for_testing(ts::ctx(&mut sc));
    grants::create_grant(ACC, string::utf8(b"shopping"), string::utf8(b"ShopBot"), pk(), 60_000, &clk, ts::ctx(&mut sc));

    ts::next_tx(&mut sc, OWNER);
    let mut g = ts::take_shared<Grant>(&sc);
    grants::revoke_grant(&mut g, &clk, ts::ctx(&mut sc));
    assert!(grants::is_revoked(&g), 0);
    assert!(!grants::is_valid(&g, &clk), 1);
    ts::return_shared(g);

    clock::destroy_for_testing(clk);
    ts::end(sc);
}

#[test]
#[expected_failure]
fun only_grantor_can_revoke() {
    let mut sc = ts::begin(OWNER);
    let clk = clock::create_for_testing(ts::ctx(&mut sc));
    grants::create_grant(ACC, string::utf8(b"shopping"), string::utf8(b"ShopBot"), pk(), 60_000, &clk, ts::ctx(&mut sc));

    ts::next_tx(&mut sc, OTHER); // a different sender tries to revoke
    let mut g = ts::take_shared<Grant>(&sc);
    grants::revoke_grant(&mut g, &clk, ts::ctx(&mut sc)); // aborts ENotGrantor
    ts::return_shared(g);
    clock::destroy_for_testing(clk);
    ts::end(sc);
}

#[test]
fun expiry_makes_invalid() {
    let mut sc = ts::begin(OWNER);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clock::set_for_testing(&mut clk, 1_000);
    grants::create_grant(ACC, string::utf8(b"shopping"), string::utf8(b"ShopBot"), pk(), 1_000, &clk, ts::ctx(&mut sc)); // expires at 2_000

    ts::next_tx(&mut sc, OWNER);
    let g = ts::take_shared<Grant>(&sc);
    assert!(grants::is_valid(&g, &clk), 0);
    clock::set_for_testing(&mut clk, 2_001); // past expiry
    assert!(!grants::is_valid(&g, &clk), 1);
    ts::return_shared(g);

    clock::destroy_for_testing(clk);
    ts::end(sc);
}

#[test]
fun log_access_runs() {
    let mut sc = ts::begin(OWNER);
    let clk = clock::create_for_testing(ts::ctx(&mut sc));
    grants::log_access(@0x9, ACC, string::utf8(b"ShopBot"), string::utf8(b"shopping"), true, string::utf8(b""), 1, &clk, ts::ctx(&mut sc));
    grants::log_access(@0x9, ACC, string::utf8(b"ShopBot"), string::utf8(b"shopping"), false, string::utf8(b"grant_revoked"), 0, &clk, ts::ctx(&mut sc));
    clock::destroy_for_testing(clk);
    ts::end(sc);
}
