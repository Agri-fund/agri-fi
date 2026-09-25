//! Unit tests for RevenueDistributorContract — Issues #873 and #1085

#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Events},
    xdr::{Hash, ScAddress},
    Address, Env, IntoVal, TryIntoVal,
};

use crate::{RevenueDistributorContract, RevenueDistributorContractClient, Error};

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

const FIRST_PRIMES: [i128; 11] = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31];

fn prime_holder_address(env: &Env, index: u32) -> Address {
    let mut hash = [0u8; 32];
    hash[28..].copy_from_slice(&index.to_be_bytes());
    ScAddress::Contract(Hash(hash)).try_into_val(env).unwrap()
}

fn assert_prime_distribution(
    allocations: &[i128],
    floor_payouts: &[i128],
    total_amount: i128,
) {
    assert!(allocations.len() <= FIRST_PRIMES.len());
    assert_eq!(allocations.len(), floor_payouts.len());
    for (index, allocation) in allocations.iter().enumerate() {
        assert_eq!(*allocation, FIRST_PRIMES[index]);
    }

    let f = TestFixture::setup();
    let total_supply: i128 = allocations.iter().sum();
    let largest_allocation_holder = prime_holder_address(&f.env, 0);
    let largest_allocation = *allocations.last().unwrap();
    f.client.register_holder(
        &f.admin,
        &largest_allocation_holder,
        &largest_allocation,
    );

    for (index, allocation) in allocations[..allocations.len() - 1].iter().enumerate() {
        let holder = prime_holder_address(&f.env, index as u32 + 1);
        f.client.register_holder(&f.admin, &holder, allocation);
    }

    let final_registered_holder = prime_holder_address(&f.env, allocations.len() as u32 - 1);
    assert_ne!(final_registered_holder, largest_allocation_holder);
    assert_eq!(f.client.get_total_supply(), total_supply);

    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&f.env, &f.usdc);
    token_admin_client.mint(&f.contract_id, &total_amount);

    let token_client = soroban_sdk::token::Client::new(&f.env, &f.usdc);
    let contract_balance_before = token_client.balance(&f.contract_id);
    assert_eq!(contract_balance_before, total_amount);

    let holder_keys = f.client.get_holders().keys();
    let count = holder_keys.len();
    assert_eq!(count as usize, allocations.len());
    let final_holder = holder_keys.last().unwrap();
    assert_eq!(final_holder, final_registered_holder);
    assert_ne!(final_holder, largest_allocation_holder);
    for index in 0..count {
        assert_eq!(token_client.balance(&holder_keys.get(index).unwrap()), 0);
    }

    let payouts = f.client.distribute(&f.admin, &f.usdc, &total_amount);
    assert_eq!(payouts.len(), count);

    let mut received = 0;
    let mut received_before_last = 0;
    for index in 0..count {
        let holder = holder_keys.get(index).unwrap();
        let allocation = f.client.get_holder_balance(&holder);
        let allocation_index = allocations
            .iter()
            .position(|candidate| *candidate == allocation)
            .unwrap();
        let expected = if index + 1 == count {
            total_amount - received_before_last
        } else {
            floor_payouts[allocation_index]
        };
        let actual = payouts.get(holder.clone()).unwrap();

        assert_eq!(actual, expected);
        assert_eq!(token_client.balance(&holder), actual);
        received += actual;
        if index + 1 < count {
            received_before_last = received;
        }
    }

    assert_eq!(received, total_amount);
    let contract_balance_after = token_client.balance(&f.contract_id);
    assert_eq!(contract_balance_after, 0);
    assert_eq!(received + contract_balance_after, contract_balance_before);

    let last_allocation = f.client.get_holder_balance(&final_holder);
    assert_ne!(last_allocation, largest_allocation);
    let last_floor_index = allocations
        .iter()
        .position(|candidate| *candidate == last_allocation)
        .unwrap();
    let last_floor = floor_payouts[last_floor_index];
    let floor_sum: i128 = floor_payouts.iter().sum();
    let leftover_units = total_amount - floor_sum;
    let last_payout = payouts.get(final_holder.clone()).unwrap();

    assert!(leftover_units > 0);
    assert_eq!(last_payout, total_amount - (floor_sum - last_floor));
    assert_eq!(last_payout, last_floor + leftover_units);
    assert!(last_payout > last_floor);
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

/// Fractional shares — verifies remainder goes to the final map entry.
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
    let h1_amount = payouts.get(h1.clone()).unwrap();
    let h2_amount = payouts.get(h2.clone()).unwrap();
    let holder_keys = f.client.get_holders().keys();
    let last_holder = holder_keys.last().unwrap();
    let other_holder = if &last_holder == &h1 { h2.clone() } else { h1.clone() };
    let (last_amount, other_amount) = if &last_holder == &h1 {
        (h1_amount, h2_amount)
    } else {
        (h2_amount, h1_amount)
    };
    let expected_other_amount = if f.client.get_holder_balance(&other_holder) == 1 {
        33
    } else {
        66
    };

    assert_eq!(other_amount, expected_other_amount);
    assert_eq!(last_amount, total_amount - expected_other_amount);
    assert_eq!(h1_amount + h2_amount, total_amount);

    let token_client = soroban_sdk::token::Client::new(&f.env, &f.usdc);
    assert_eq!(token_client.balance(&h1), h1_amount);
    assert_eq!(token_client.balance(&h2), h2_amount);
    assert_eq!(token_client.balance(&f.contract_id), 0);
}

#[test]
fn test_prime_holder_count_3() {
    assert_prime_distribution(&[2, 3, 5], &[20, 30, 50], 101);
}

#[test]
fn test_prime_holder_count_5() {
    assert_prime_distribution(&[2, 3, 5, 7, 11], &[7, 10, 18, 25, 39], 101);
}

#[test]
fn test_prime_holder_count_7() {
    assert_prime_distribution(
        &[2, 3, 5, 7, 11, 13, 17],
        &[3, 5, 8, 12, 19, 22, 29],
        101,
    );
}

#[test]
fn test_prime_holder_count_11() {
    assert_prime_distribution(
        &[2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31],
        &[1, 1, 3, 4, 6, 8, 10, 11, 14, 18, 19],
        101,
    );
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
