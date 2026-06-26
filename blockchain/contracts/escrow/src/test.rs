#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Env, IntoVal, Val,
};

fn create_usdc_token(env: &Env, admin: &Address) -> Address {
    let token_addr = env.register_stellar_asset_contract(admin.clone());
    let token = token::Client::new(env, &token_addr);
    token
}

struct Setup {
    _env: Env,
    contract_id: Address,
    admin: Address,
    farmer: Address,
    platform: Address,
    usdc_token: Address,
    usdc: token::Client,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let platform = Address::generate(&env);

    let usdc_token = create_usdc_token(&env, &admin);
    let usdc = token::Client::new(&env, &usdc_token);

    let contract_id = env.register_contract(None, EscrowContract);
    EscrowContractClient::new(&env, &contract_id).initialize(
        &admin,
        &farmer,
        &platform,
        &usdc_token,
    );

    Setup {
        _env: env,
        contract_id,
        admin,
        farmer,
        platform,
        usdc_token,
        usdc,
    }
}

fn fund_contract(setup: &Setup, amount: i128) {
    let investor = Address::generate(&setup._env);
    setup.usdc.mint(&investor, &amount);
    EscrowContractClient::new(&setup._env, &setup.contract_id).fund(&investor, &amount);
}

#[test]
fn test_initialize() {
    let setup = setup();
    assert!(!EscrowContractClient::new(&setup._env, &setup.contract_id).is_released());
}

#[test]
fn test_initialize_twice_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let platform = Address::generate(&env);
    let usdc_token = Address::generate(&env);

    let contract_id = env.register_contract(None, EscrowContract);
    let client = EscrowContractClient::new(&env, &contract_id);
    client.initialize(&admin, &farmer, &platform, &usdc_token);

    let result = client.try_initialize(&admin, &farmer, &platform, &usdc_token);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_fund_increases_balance() {
    let setup = setup();
    let investor = Address::generate(&setup._env);
    let amount: i128 = 10_000_000_000;

    setup.usdc.mint(&investor, &amount);
    EscrowContractClient::new(&setup._env, &setup.contract_id).fund(&investor, &amount);

    let total = EscrowContractClient::new(&setup._env, &setup.contract_id).get_total_funded();
    assert_eq!(total, amount);
}

#[test]
fn test_fund_with_zero_amount_fails() {
    let setup = setup();
    let investor = Address::generate(&setup._env);

    let result =
        EscrowContractClient::new(&setup._env, &setup.contract_id).try_fund(&investor, &0);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_release_distributes_98_percent_to_farmer_and_2_percent_to_platform() {
    let setup = setup();
    let total_funded: i128 = 10_000_000_000; // 10000 USDC (7-decimal)
    fund_contract(&setup, total_funded);

    let farmer_balance_before = setup.usdc.balance(&setup.farmer);
    let platform_balance_before = setup.usdc.balance(&setup.platform);

    EscrowContractClient::new(&setup._env, &setup.contract_id).approve_delivery(&setup.admin);
    EscrowContractClient::new(&setup._env, &setup.contract_id).release(&setup.admin);

    let expected_farmer = (total_funded * 98) / 100;
    let expected_platform = total_funded - expected_farmer;

    let farmer_balance_after = setup.usdc.balance(&setup.farmer);
    let platform_balance_after = setup.usdc.balance(&setup.platform);

    assert_eq!(farmer_balance_after - farmer_balance_before, expected_farmer);
    assert_eq!(
        platform_balance_after - platform_balance_before,
        expected_platform
    );
    assert!(
        EscrowContractClient::new(&setup._env, &setup.contract_id).is_released()
    );
}

#[test]
fn test_release_without_delivery_approval_fails() {
    let setup = setup();
    let total_funded: i128 = 10_000_000_000;
    fund_contract(&setup, total_funded);

    let result =
        EscrowContractClient::new(&setup._env, &setup.contract_id).try_release(&setup.admin);
    assert_eq!(result, Err(Ok(Error::DeliveryNotApproved)));
}

#[test]
fn test_double_release_fails() {
    let setup = setup();
    let total_funded: i128 = 10_000_000_000;
    fund_contract(&setup, total_funded);

    EscrowContractClient::new(&setup._env, &setup.contract_id).approve_delivery(&setup.admin);
    EscrowContractClient::new(&setup._env, &setup.contract_id).release(&setup.admin);

    let result =
        EscrowContractClient::new(&setup._env, &setup.contract_id).try_release(&setup.admin);
    assert_eq!(result, Err(Ok(Error::AlreadyReleased)));
}

#[test]
fn test_unauthorized_account_cannot_submit_delivery_milestone() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let platform = Address::generate(&env);
    let usdc_token = Address::generate(&env);

    let contract_id = env.register_contract(None, EscrowContract);
    EscrowContractClient::new(&env, &contract_id).initialize(
        &admin,
        &farmer,
        &platform,
        &usdc_token,
    );

    // Use a random unauthorized address
    let unauthorized = Address::generate(&env);

    let result = EscrowContractClient::new(&env, &contract_id).try_submit_delivery_milestone(
        &unauthorized,
    );
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_farmer_can_submit_delivery_milestone() {
    let setup = setup();
    EscrowContractClient::new(&setup._env, &setup.contract_id)
        .submit_delivery_milestone(&setup.farmer);

    assert!(
        EscrowContractClient::new(&setup._env, &setup.contract_id).is_delivery_approved()
    );
}

#[test]
fn test_admin_can_submit_delivery_milestone() {
    let setup = setup();
    EscrowContractClient::new(&setup._env, &setup.contract_id)
        .submit_delivery_milestone(&setup.admin);

    assert!(
        EscrowContractClient::new(&setup._env, &setup.contract_id).is_delivery_approved()
    );
}

#[test]
fn test_fund_from_multiple_investors() {
    let setup = setup();
    let investor1 = Address::generate(&setup._env);
    let investor2 = Address::generate(&setup._env);
    let amount1: i128 = 5_000_000_000;
    let amount2: i128 = 3_000_000_000;

    setup.usdc.mint(&investor1, &amount1);
    setup.usdc.mint(&investor2, &amount2);

    EscrowContractClient::new(&setup._env, &setup.contract_id).fund(&investor1, &amount1);
    EscrowContractClient::new(&setup._env, &setup.contract_id).fund(&investor2, &amount2);

    let total = EscrowContractClient::new(&setup._env, &setup.contract_id).get_total_funded();
    assert_eq!(total, amount1 + amount2);
}

#[test]
fn test_release_with_zero_balance_fails() {
    let setup = setup();
    EscrowContractClient::new(&setup._env, &setup.contract_id).approve_delivery(&setup.admin);

    let result =
        EscrowContractClient::new(&setup._env, &setup.contract_id).try_release(&setup.admin);
    assert_eq!(result, Err(Ok(Error::BalanceInsufficient)));
}
