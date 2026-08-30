//! Unit tests for RevenueDistributorContract — Issue #873

#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Events},
    Address, Env, IntoVal,
};

use crate::{RevenueDistributorContract, RevenueDistributorContractClient, Error};

// ── Test token (minimal mock for transfer tracking) ───────────────────────────

mod token_contract {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32-unknown-unknown/release/soroban_token_contract.wasm"
    );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

struct TestFixture {
    env: Env,
    contract_id: Address,
    client: RevenueDistributorContractClient<'static>,
    admin: Address,
    usdc: Address,
}

impl TestFixture {
    fn setup() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        // Deploy a real USDC token for transfer verification
        let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();

        let contract_id = env.register_contract(None, RevenueDistributorContract);
        // SAFETY: the 'static lifetime here is safe in the test context because
        // the Env lives for the duration of the test function.
        let client = RevenueDistributorContractClient::new(
            unsafe { &*(&env as *const Env) },
            &contract_id,
        );

        client.initialize(&admin, &usdc);

        Self { env, contract_id, client, admin, usdc }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/// Equal split across three holders.
#[test]
fn test_equal_split() {
    let f = TestFixture::setup();

    let h1 = Address::generate(&f.env);
    let h2 = Address::generate(&f.env);
    let h3 = Address::generate(&f.env);

    // Register 100 tokens each → total supply = 300
    f.client.register_holder(&f.admin, &h1, &100);
    f.client.register_holder(&f.admin, &h2, &100);
    f.client.register_holder(&f.admin, &h3, &100);

    assert_eq!(f.client.get_total_supply(), 300);

    // Fund the contract with 300 USDC stroops
    let total_amount: i128 = 300;
    // Mint to contract so transfers succeed
    let token_client = soroban_sdk::token::Client::new(&f.env, &f.usdc);
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&f.env, &f.usdc);
    token_admin_client.mint(&f.contract_id, &total_amount);

    let payouts = f.client.distribute(&f.admin, &f.usdc, &total_amount);

    assert_eq!(payouts.get(h1.clone()).unwrap(), 100);
    assert_eq!(payouts.get(h2.clone()).unwrap(), 100);
    assert_eq!(payouts.get(h3.clone()).unwrap(), 100);

    assert_eq!(f.client.get_distribution_count(), 1);
}

/// Fractional shares — verifies remainder goes to last holder.
#[test]
fn test_fractional_shares() {
    let f = TestFixture::setup();

    let h1 = Address::generate(&f.env);
    let h2 = Address::generate(&f.env);

    // 1/3 and 2/3 split
    f.client.register_holder(&f.admin, &h1, &1);
    f.client.register_holder(&f.admin, &h2, &2);

    let total_amount: i128 = 100; // not divisible by 3
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&f.env, &f.usdc);
    token_admin_client.mint(&f.contract_id, &total_amount);

    let payouts = f.client.distribute(&f.admin, &f.usdc, &total_amount);

    // h1 gets floor(1*100/3) = 33; h2 (last) gets remainder = 67
    let h1_amount = payouts.get(h1.clone()).unwrap();
    let h2_amount = payouts.get(h2.clone()).unwrap();

    assert_eq!(h1_amount + h2_amount, total_amount, "All funds must be distributed");
    // h1 gets the floor share
    assert!(h1_amount >= 33 && h1_amount <= 34);
    // h2 gets the rest
    assert_eq!(h2_amount, total_amount - h1_amount);
}

/// Single holder receives 100% of distribution.
#[test]
fn test_single_holder() {
    let f = TestFixture::setup();

    let h1 = Address::generate(&f.env);
    f.client.register_holder(&f.admin, &h1, &1_000_000);

    let total_amount: i128 = 50_000_000; // 5 USDC (7-decimal)
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&f.env, &f.usdc);
    token_admin_client.mint(&f.contract_id, &total_amount);

    let payouts = f.client.distribute(&f.admin, &f.usdc, &total_amount);

    assert_eq!(payouts.get(h1).unwrap(), total_amount);
    assert_eq!(f.client.get_distribution_count(), 1);
}

/// Unauthorized caller is rejected.
#[test]
fn test_unauthorized_distribute() {
    let f = TestFixture::setup();
    let attacker = Address::generate(&f.env);

    let result = f.client.try_distribute(&attacker, &f.usdc, &100);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

/// Zero supply returns ZeroSupply error.
#[test]
fn test_zero_supply_error() {
    let f = TestFixture::setup();
    let result = f.client.try_distribute(&f.admin, &f.usdc, &100);
    assert_eq!(result, Err(Ok(Error::ZeroSupply)));
}

/// InvalidAmount when total_amount <= 0.
#[test]
fn test_invalid_amount() {
    let f = TestFixture::setup();
    let h1 = Address::generate(&f.env);
    f.client.register_holder(&f.admin, &h1, &100);

    let result = f.client.try_distribute(&f.admin, &f.usdc, &0);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

/// AlreadyInitialized guard works.
#[test]
fn test_double_initialize() {
    let f = TestFixture::setup();
    let admin2 = Address::generate(&f.env);
    let result = f.client.try_initialize(&admin2, &f.usdc);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

/// RevenueDistributed events are emitted per holder.
#[test]
fn test_events_emitted() {
    let f = TestFixture::setup();
    let h1 = Address::generate(&f.env);
    f.client.register_holder(&f.admin, &h1, &100);

    let total_amount: i128 = 100;
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&f.env, &f.usdc);
    token_admin_client.mint(&f.contract_id, &total_amount);

    f.client.distribute(&f.admin, &f.usdc, &total_amount);

    let events = f.env.events().all();
    // Expect at least a rev_dist event and a dist_done event
    assert!(events.len() >= 2);
}
