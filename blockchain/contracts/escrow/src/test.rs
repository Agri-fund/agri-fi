#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Env, IntoVal, Val, Vec,
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
    investors: Vec<Address>,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let platform = Address::generate(&env);
    let investor1 = Address::generate(&env);
    let investor2 = Address::generate(&env);

    let mut investors = Vec::new(&env);
    investors.push_back(investor1);
    investors.push_back(investor2);

    let usdc_token = create_usdc_token(&env, &admin);
    let usdc = token::Client::new(&env, &usdc_token);

    let contract_id = env.register_contract(None, EscrowContract);
    let deal_value: i128 = 10_000_000_000; // 1000 USDC
    let milestone_count: u32 = 3; // 3 milestones

    EscrowContractClient::new(&env, &contract_id).initialize(
        &admin,
        &farmer,
        &platform,
        &usdc_token,
        &deal_value,
        &milestone_count,
        &investors,
    );

    Setup {
        _env: env,
        contract_id,
        admin,
        farmer,
        platform,
        usdc_token,
        usdc,
        investors,
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

    let mut investors = Vec::new(&env);
    investors.push_back(Address::generate(&env));

    let contract_id = env.register_contract(None, EscrowContract);
    let client = EscrowContractClient::new(&env, &contract_id);
    client.initialize(&admin, &farmer, &platform, &usdc_token, &1000, &1, &investors);

    let result = client.try_initialize(&admin, &farmer, &platform, &usdc_token, &1000, &1, &investors);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_initialize_with_zero_deal_value_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let platform = Address::generate(&env);
    let usdc_token = Address::generate(&env);

    let mut investors = Vec::new(&env);
    investors.push_back(Address::generate(&env));

    let contract_id = env.register_contract(None, EscrowContract);
    let client = EscrowContractClient::new(&env, &contract_id);
    let result = client.try_initialize(&admin, &farmer, &platform, &usdc_token, &0, &1, &investors);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_initialize_with_zero_milestones_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let platform = Address::generate(&env);
    let usdc_token = Address::generate(&env);

    let mut investors = Vec::new(&env);
    investors.push_back(Address::generate(&env));

    let contract_id = env.register_contract(None, EscrowContract);
    let client = EscrowContractClient::new(&env, &contract_id);
    let result = client.try_initialize(&admin, &farmer, &platform, &usdc_token, &1000, &0, &investors);
    assert_eq!(result, Err(Ok(Error::InvalidMilestones)));
}

#[test]
fn test_initialize_with_no_investors_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let platform = Address::generate(&env);
    let usdc_token = Address::generate(&env);

    let investors = Vec::new(&env);

    let contract_id = env.register_contract(None, EscrowContract);
    let client = EscrowContractClient::new(&env, &contract_id);
    let result = client.try_initialize(&admin, &farmer, &platform, &usdc_token, &1000, &1, &investors);
    assert_eq!(result, Err(Ok(Error::NoInvestors)));
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

// ========== Tests for Milestone Recording (Issue #345) ==========

#[test]
fn test_record_milestone_by_admin() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);

    // Admin can record milestone 0
    let result = client.try_record_milestone(&setup.admin, &0);
    assert!(result.is_ok());

    // Verify milestone is recorded
    assert!(client.is_milestone_completed(&0));
    assert_eq!(client.get_milestones_completed(), 1);
}

#[test]
fn test_record_milestone_by_farmer() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);

    // Farmer can record milestone 0
    let result = client.try_record_milestone(&setup.farmer, &0);
    assert!(result.is_ok());

    // Verify milestone is recorded
    assert!(client.is_milestone_completed(&0));
    assert_eq!(client.get_milestones_completed(), 1);
}

#[test]
fn test_record_milestone_by_unauthorized_fails() {
    let setup = setup();
    let unauthorized = Address::generate(&setup._env);
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);

    // Unauthorized account cannot record milestone
    let result = client.try_record_milestone(&unauthorized, &0);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_record_milestone_with_invalid_id_fails() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);

    // Milestone ID 3 is out of range (only 0, 1, 2 are valid for 3 milestones)
    let result = client.try_record_milestone(&setup.admin, &3);
    assert_eq!(result, Err(Ok(Error::InvalidMilestones)));
}

#[test]
fn test_record_same_milestone_twice_fails() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);

    // Record milestone 0
    client.record_milestone(&setup.admin, &0);

    // Try to record same milestone again
    let result = client.try_record_milestone(&setup.admin, &0);
    assert_eq!(result, Err(Ok(Error::MilestoneAlreadyRecorded)));
}

#[test]
fn test_record_all_milestones() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);

    // Record all 3 milestones
    client.record_milestone(&setup.admin, &0);
    client.record_milestone(&setup.admin, &1);
    client.record_milestone(&setup.admin, &2);

    // Verify all milestones recorded
    assert_eq!(client.get_milestones_completed(), 3);
    assert_eq!(client.get_milestones_count(), 3);
    assert_eq!(client.get_completion_progress(), 100);
}

#[test]
fn test_completion_progress_tracking() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);

    // Initially 0% complete
    assert_eq!(client.get_completion_progress(), 0);

    // After 1 milestone: 33%
    client.record_milestone(&setup.admin, &0);
    assert_eq!(client.get_completion_progress(), 33);

    // After 2 milestones: 66%
    client.record_milestone(&setup.admin, &1);
    assert_eq!(client.get_completion_progress(), 66);

    // After 3 milestones: 100%
    client.record_milestone(&setup.admin, &2);
    assert_eq!(client.get_completion_progress(), 100);
}

// ========== Tests for Settle Escrow (Issue #345) ==========

#[test]
fn test_settle_escrow_requires_all_milestones() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);
    let total_funded: i128 = 10_000_000_000;

    fund_contract(&setup, total_funded);

    // Record only 2 of 3 milestones
    client.record_milestone(&setup.admin, &0);
    client.record_milestone(&setup.admin, &1);

    // Try to settle without all milestones
    let result = client.try_settle_escrow(&setup.admin);
    assert_eq!(result, Err(Ok(Error::InsufficientMilestonesCompleted)));
}

#[test]
fn test_settle_escrow_with_all_milestones() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);
    let total_funded: i128 = 10_000_000_000;

    fund_contract(&setup, total_funded);

    // Record all milestones
    client.record_milestone(&setup.admin, &0);
    client.record_milestone(&setup.admin, &1);
    client.record_milestone(&setup.admin, &2);

    // Now settle should work
    let result = client.try_settle_escrow(&setup.admin);
    assert!(result.is_ok());

    // Verify released flag is set
    assert!(client.is_released());
}

#[test]
fn test_settle_escrow_requires_sufficient_funds() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);

    // Record all milestones
    client.record_milestone(&setup.admin, &0);
    client.record_milestone(&setup.admin, &1);
    client.record_milestone(&setup.admin, &2);

    // But don't fund the contract (0 balance, need 10_000_000_000)
    let result = client.try_settle_escrow(&setup.admin);
    assert_eq!(result, Err(Ok(Error::BalanceInsufficient)));
}

#[test]
fn test_settle_escrow_unauthorized() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);
    let unauthorized = Address::generate(&setup._env);

    let total_funded: i128 = 10_000_000_000;
    fund_contract(&setup, total_funded);

    // Record all milestones
    client.record_milestone(&setup.admin, &0);
    client.record_milestone(&setup.admin, &1);
    client.record_milestone(&setup.admin, &2);

    // Unauthorized account cannot settle
    let result = client.try_settle_escrow(&unauthorized);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_settle_escrow_twice_fails() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);
    let total_funded: i128 = 10_000_000_000;

    fund_contract(&setup, total_funded);

    // Record all milestones
    client.record_milestone(&setup.admin, &0);
    client.record_milestone(&setup.admin, &1);
    client.record_milestone(&setup.admin, &2);

    // Settle once
    client.settle_escrow(&setup.admin);

    // Try to settle again
    let result = client.try_settle_escrow(&setup.admin);
    assert_eq!(result, Err(Ok(Error::AlreadyReleased)));
}

#[test]
fn test_settle_escrow_distributes_98_to_farmer_2_to_platform() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);
    let total_funded: i128 = 10_000_000_000;

    fund_contract(&setup, total_funded);

    // Record all milestones
    client.record_milestone(&setup.admin, &0);
    client.record_milestone(&setup.admin, &1);
    client.record_milestone(&setup.admin, &2);

    let farmer_balance_before = setup.usdc.balance(&setup.farmer);
    let platform_balance_before = setup.usdc.balance(&setup.platform);

    // Settle escrow
    client.settle_escrow(&setup.admin);

    let expected_farmer = (total_funded * 98) / 100;
    let expected_platform = total_funded - expected_farmer;

    let farmer_balance_after = setup.usdc.balance(&setup.farmer);
    let platform_balance_after = setup.usdc.balance(&setup.platform);

    assert_eq!(farmer_balance_after - farmer_balance_before, expected_farmer);
    assert_eq!(
        platform_balance_after - platform_balance_before,
        expected_platform
    );
}

#[test]
fn test_get_deal_value() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);

    assert_eq!(client.get_deal_value(), 10_000_000_000);
}

#[test]
fn test_get_milestones_count() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);

    assert_eq!(client.get_milestones_count(), 3);
}

#[test]
fn test_get_investors() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);

    let investors = client.get_investors();
    assert_eq!(investors.len(), 2);
    // Verify investors are in the map (order may vary with Map)
    let investor1 = setup.investors.get(0).unwrap();
    let investor2 = setup.investors.get(1).unwrap();
    let mut found1 = false;
    let mut found2 = false;
    for investor in investors.iter() {
        if investor == investor1 {
            found1 = true;
        }
        if investor == investor2 {
            found2 = true;
        }
    }
    assert!(found1 && found2);
}
