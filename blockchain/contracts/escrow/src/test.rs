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
    let funding_deadline: u64 = 1000; // Future timestamp

    EscrowContractClient::new(&env, &contract_id).initialize(
        &admin,
        &farmer,
        &platform,
        &usdc_token,
        &deal_value,
        &milestone_count,
        &investors,
        &funding_deadline,
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
    client.initialize(&admin, &farmer, &platform, &usdc_token, &1000, &1, &investors, &1000);

    let result = client.try_initialize(&admin, &farmer, &platform, &usdc_token, &1000, &1, &investors, &1000);
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
    let result = client.try_initialize(&admin, &farmer, &platform, &usdc_token, &0, &1, &investors, &1000);
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
    let result = client.try_initialize(&admin, &farmer, &platform, &usdc_token, &1000, &0, &investors, &1000);
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
    let result = client.try_initialize(&admin, &farmer, &platform, &usdc_token, &1000, &1, &investors, &1000);
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

    let mut investors = Vec::new(&env);
    investors.push_back(Address::generate(&env));

    let contract_id = env.register_contract(None, EscrowContract);
    EscrowContractClient::new(&env, &contract_id).initialize(
        &admin,
        &farmer,
        &platform,
        &usdc_token,
        &1000,
        &1,
        &investors,
        &1000,
    );

    // Use a random unauthorized address
    let unauthorized = Address::generate(&env);

    let result = EscrowContractClient::new(&env, &contract_id).try_submit_delivery_milestone(
        &unauthorized,
    );
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_release_by_unauthorized_caller_fails() {
    let setup = setup();
    let unauthorized = Address::generate(&setup._env);
    let total_funded: i128 = 10_000_000_000;
    fund_contract(&setup, total_funded);

    EscrowContractClient::new(&setup._env, &setup.contract_id).approve_delivery(&setup.admin);

    let result = EscrowContractClient::new(&setup._env, &setup.contract_id)
        .try_release(&unauthorized);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));

    // Funds remain untouched and released flag stays false
    assert!(!EscrowContractClient::new(&setup._env, &setup.contract_id).is_released());
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

// ========== Tests for Funding Deadline and Refunds (Issue #345) ==========

#[test]
fn test_get_funding_deadline() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);

    assert_eq!(client.get_funding_deadline(), 1000);
}

#[test]
fn test_target_met_when_funded() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);
    let total_funded: i128 = 10_000_000_000;

    fund_contract(&setup, total_funded);

    assert!(client.target_met());
}

#[test]
fn test_target_not_met_when_underfunded() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);
    let partial_funding: i128 = 5_000_000_000; // Half of target

    fund_contract(&setup, partial_funding);

    assert!(!client.target_met());
}

#[test]
fn test_refund_after_expiry_before_deadline_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let platform = Address::generate(&env);
    let investor1 = Address::generate(&env);
    let investor2 = Address::generate(&env);

    let mut investors = Vec::new(&env);
    investors.push_back(investor1.clone());
    investors.push_back(investor2);

    let usdc_token = create_usdc_token(&env, &admin);
    let usdc = token::Client::new(&env, &usdc_token);

    let contract_id = env.register_contract(None, EscrowContract);
    let deal_value: i128 = 10_000_000_000;
    let milestone_count: u32 = 3;
    let funding_deadline: u64 = 1000; // Future timestamp

    EscrowContractClient::new(&env, &contract_id).initialize(
        &admin,
        &farmer,
        &platform,
        &usdc_token,
        &deal_value,
        &milestone_count,
        &investors,
        &funding_deadline,
    );

    // Fund the contract
    let amount: i128 = 5_000_000_000;
    usdc.mint(&investor1, &amount);
    EscrowContractClient::new(&env, &contract_id).fund(&investor1, &amount);

    // Try to refund before deadline (current timestamp is 0, deadline is 1000)
    let result = EscrowContractClient::new(&env, &contract_id)
        .try_refund_after_expiry(&investor1);
    assert_eq!(result, Err(Ok(Error::DeadlineNotPassed)));
}

#[test]
fn test_refund_after_expiry_when_target_met_fails() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(2000); // Set time past deadline

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let platform = Address::generate(&env);
    let investor1 = Address::generate(&env);
    let investor2 = Address::generate(&env);

    let mut investors = Vec::new(&env);
    investors.push_back(investor1.clone());
    investors.push_back(investor2);

    let usdc_token = create_usdc_token(&env, &admin);
    let usdc = token::Client::new(&env, &usdc_token);

    let contract_id = env.register_contract(None, EscrowContract);
    let deal_value: i128 = 10_000_000_000;
    let milestone_count: u32 = 3;
    let funding_deadline: u64 = 1000; // Past timestamp

    EscrowContractClient::new(&env, &contract_id).initialize(
        &admin,
        &farmer,
        &platform,
        &usdc_token,
        &deal_value,
        &milestone_count,
        &investors,
        &funding_deadline,
    );

    // Fund the contract to meet target
    let amount: i128 = 10_000_000_000;
    usdc.mint(&investor1, &amount);
    EscrowContractClient::new(&env, &contract_id).fund(&investor1, &amount);

    // Try to refund when target is met
    let result = EscrowContractClient::new(&env, &contract_id)
        .try_refund_after_expiry(&investor1);
    assert_eq!(result, Err(Ok(Error::TargetMet)));
}

#[test]
fn test_refund_after_expiry_success() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(2000); // Set time past deadline

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let platform = Address::generate(&env);
    let investor1 = Address::generate(&env);
    let investor2 = Address::generate(&env);

    let mut investors = Vec::new(&env);
    investors.push_back(investor1.clone());
    investors.push_back(investor2);

    let usdc_token = create_usdc_token(&env, &admin);
    let usdc = token::Client::new(&env, &usdc_token);

    let contract_id = env.register_contract(None, EscrowContract);
    let deal_value: i128 = 10_000_000_000;
    let milestone_count: u32 = 3;
    let funding_deadline: u64 = 1000; // Past timestamp

    EscrowContractClient::new(&env, &contract_id).initialize(
        &admin,
        &farmer,
        &platform,
        &usdc_token,
        &deal_value,
        &milestone_count,
        &investors,
        &funding_deadline,
    );

    // Fund the contract partially (under target)
    let amount: i128 = 5_000_000_000;
    usdc.mint(&investor1, &amount);
    EscrowContractClient::new(&env, &contract_id).fund(&investor1, &amount);

    let balance_before = usdc.balance(&investor1);

    // Refund after expiry
    let result = EscrowContractClient::new(&env, &contract_id)
        .refund_after_expiry(&investor1);
    assert!(result.is_ok());

    let balance_after = usdc.balance(&investor1);
    assert_eq!(balance_after - balance_before, amount);

    // Verify total funded was reduced
    let total_funded = EscrowContractClient::new(&env, &contract_id).get_total_funded();
    assert_eq!(total_funded, 0);
}

#[test]
fn test_refund_after_expiry_idempotent() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(2000); // Set time past deadline

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let platform = Address::generate(&env);
    let investor1 = Address::generate(&env);
    let investor2 = Address::generate(&env);

    let mut investors = Vec::new(&env);
    investors.push_back(investor1.clone());
    investors.push_back(investor2);

    let usdc_token = create_usdc_token(&env, &admin);
    let usdc = token::Client::new(&env, &usdc_token);

    let contract_id = env.register_contract(None, EscrowContract);
    let deal_value: i128 = 10_000_000_000;
    let milestone_count: u32 = 3;
    let funding_deadline: u64 = 1000; // Past timestamp

    EscrowContractClient::new(&env, &contract_id).initialize(
        &admin,
        &farmer,
        &platform,
        &usdc_token,
        &deal_value,
        &milestone_count,
        &investors,
        &funding_deadline,
    );

    // Fund the contract partially
    let amount: i128 = 5_000_000_000;
    usdc.mint(&investor1, &amount);
    EscrowContractClient::new(&env, &contract_id).fund(&investor1, &amount);

    // First refund
    let result1 = EscrowContractClient::new(&env, &contract_id)
        .refund_after_expiry(&investor1);
    assert!(result1.is_ok());

    // Second refund (should succeed idempotently)
    let result2 = EscrowContractClient::new(&env, &contract_id)
        .try_refund_after_expiry(&investor1);
    assert!(result2.is_ok()); // Should succeed, not error
}

#[test]
fn test_refund_after_expiry_nothing_to_refund() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(2000); // Set time past deadline

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let platform = Address::generate(&env);
    let investor1 = Address::generate(&env);
    let investor2 = Address::generate(&env);

    let mut investors = Vec::new(&env);
    investors.push_back(investor1.clone());
    investors.push_back(investor2);

    let usdc_token = create_usdc_token(&env, &admin);

    let contract_id = env.register_contract(None, EscrowContract);
    let deal_value: i128 = 10_000_000_000;
    let milestone_count: u32 = 3;
    let funding_deadline: u64 = 1000; // Past timestamp

    EscrowContractClient::new(&env, &contract_id).initialize(
        &admin,
        &farmer,
        &platform,
        &usdc_token,
        &deal_value,
        &milestone_count,
        &investors,
        &funding_deadline,
    );

    // Try to refund without having funded
    let result = EscrowContractClient::new(&env, &contract_id)
        .try_refund_after_expiry(&investor1);
    assert_eq!(result, Err(Ok(Error::NothingToRefund)));
}

#[test]
fn test_refund_all_after_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(2000); // Set time past deadline

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let platform = Address::generate(&env);
    let investor1 = Address::generate(&env);
    let investor2 = Address::generate(&env);

    let mut investors = Vec::new(&env);
    investors.push_back(investor1.clone());
    investors.push_back(investor2.clone());

    let usdc_token = create_usdc_token(&env, &admin);
    let usdc = token::Client::new(&env, &usdc_token);

    let contract_id = env.register_contract(None, EscrowContract);
    let deal_value: i128 = 10_000_000_000;
    let milestone_count: u32 = 3;
    let funding_deadline: u64 = 1000; // Past timestamp

    EscrowContractClient::new(&env, &contract_id).initialize(
        &admin,
        &farmer,
        &platform,
        &usdc_token,
        &deal_value,
        &milestone_count,
        &investors,
        &funding_deadline,
    );

    // Fund the contract partially with multiple investors
    let amount1: i128 = 3_000_000_000;
    let amount2: i128 = 2_000_000_000;
    usdc.mint(&investor1, &amount1);
    usdc.mint(&investor2, &amount2);
    EscrowContractClient::new(&env, &contract_id).fund(&investor1, &amount1);
    EscrowContractClient::new(&env, &contract_id).fund(&investor2, &amount2);

    let balance1_before = usdc.balance(&investor1);
    let balance2_before = usdc.balance(&investor2);

    // Batch refund all
    let result = EscrowContractClient::new(&env, &contract_id)
        .refund_all_after_expiry(&admin);
    assert!(result.is_ok());

    let balance1_after = usdc.balance(&investor1);
    let balance2_after = usdc.balance(&investor2);

    assert_eq!(balance1_after - balance1_before, amount1);
    assert_eq!(balance2_after - balance2_before, amount2);

    // Verify total funded was reduced to 0
    let total_funded = EscrowContractClient::new(&env, &contract_id).get_total_funded();
    assert_eq!(total_funded, 0);
}

#[test]
fn test_refund_all_after_expiry_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(2000); // Set time past deadline

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let platform = Address::generate(&env);
    let investor1 = Address::generate(&env);
    let investor2 = Address::generate(&env);
    let unauthorized = Address::generate(&env);

    let mut investors = Vec::new(&env);
    investors.push_back(investor1);
    investors.push_back(investor2);

    let usdc_token = create_usdc_token(&env, &admin);

    let contract_id = env.register_contract(None, EscrowContract);
    let deal_value: i128 = 10_000_000_000;
    let milestone_count: u32 = 3;
    let funding_deadline: u64 = 1000; // Past timestamp

    EscrowContractClient::new(&env, &contract_id).initialize(
        &admin,
        &farmer,
        &platform,
        &usdc_token,
        &deal_value,
        &milestone_count,
        &investors,
        &funding_deadline,
    );

    // Try batch refund with unauthorized account
    let result = EscrowContractClient::new(&env, &contract_id)
        .try_refund_all_after_expiry(&unauthorized);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_refund_after_expiry_boundary_at_deadline() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1000); // Set time exactly at deadline

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let platform = Address::generate(&env);
    let investor1 = Address::generate(&env);
    let investor2 = Address::generate(&env);

    let mut investors = Vec::new(&env);
    investors.push_back(investor1.clone());
    investors.push_back(investor2);

    let usdc_token = create_usdc_token(&env, &admin);
    let usdc = token::Client::new(&env, &usdc_token);

    let contract_id = env.register_contract(None, EscrowContract);
    let deal_value: i128 = 10_000_000_000;
    let milestone_count: u32 = 3;
    let funding_deadline: u64 = 1000; // Current timestamp

    EscrowContractClient::new(&env, &contract_id).initialize(
        &admin,
        &farmer,
        &platform,
        &usdc_token,
        &deal_value,
        &milestone_count,
        &investors,
        &funding_deadline,
    );

    // Fund the contract partially
    let amount: i128 = 5_000_000_000;
    usdc.mint(&investor1, &amount);
    EscrowContractClient::new(&env, &contract_id).fund(&investor1, &amount);

    // Try to refund at exactly deadline (should fail - must be AFTER deadline)
    let result = EscrowContractClient::new(&env, &contract_id)
        .try_refund_after_expiry(&investor1);
    assert_eq!(result, Err(Ok(Error::DeadlineNotPassed)));

    // Advance time by 1
    env.ledger().set_timestamp(1001);

    // Now refund should succeed
    let result = EscrowContractClient::new(&env, &contract_id)
        .refund_after_expiry(&investor1);
    assert!(result.is_ok());
}

#[test]
fn test_refund_after_expiry_after_release_fails() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(2000); // Set time past deadline

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let platform = Address::generate(&env);
    let investor1 = Address::generate(&env);
    let investor2 = Address::generate(&env);

    let mut investors = Vec::new(&env);
    investors.push_back(investor1.clone());
    investors.push_back(investor2);

    let usdc_token = create_usdc_token(&env, &admin);
    let usdc = token::Client::new(&env, &usdc_token);

    let contract_id = env.register_contract(None, EscrowContract);
    let deal_value: i128 = 10_000_000_000;
    let milestone_count: u32 = 3;
    let funding_deadline: u64 = 1000; // Past timestamp

    EscrowContractClient::new(&env, &contract_id).initialize(
        &admin,
        &farmer,
        &platform,
        &usdc_token,
        &deal_value,
        &milestone_count,
        &investors,
        &funding_deadline,
    );

    // Fund the contract to meet target
    let amount: i128 = 10_000_000_000;
    usdc.mint(&investor1, &amount);
    EscrowContractClient::new(&env, &contract_id).fund(&investor1, &amount);

    // Record all milestones
    EscrowContractClient::new(&env, &contract_id).record_milestone(&admin, &0);
    EscrowContractClient::new(&env, &contract_id).record_milestone(&admin, &1);
    EscrowContractClient::new(&env, &contract_id).record_milestone(&admin, &2);

    // Settle the escrow
    EscrowContractClient::new(&env, &contract_id).settle_escrow(&admin);

    // Try to refund after release (should fail)
    let result = EscrowContractClient::new(&env, &contract_id)
        .try_refund_after_expiry(&investor1);
    assert_eq!(result, Err(Ok(Error::AlreadyReleased)));
}

// ========== Tests for Compliance Frozen Flags ==========

#[test]
fn test_freeze_contributor() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);

    // Freeze an investor
    let result = client.try_freeze_contributor(&setup.admin, &setup.investors.get(0).unwrap());
    assert!(result.is_ok());

    // Check if investor is frozen
    assert!(client.is_contributor_frozen(&setup.investors.get(0).unwrap()));
}

#[test]
fn test_freeze_contributor_unauthorized() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);
    let unauthorized = Address::generate(&setup._env);

    // Try to freeze with unauthorized account
    let result = client.try_freeze_contributor(&unauthorized, &setup.investors.get(0).unwrap());
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_unfreeze_contributor() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);
    let investor = setup.investors.get(0).unwrap();

    // Freeze first
    client.freeze_contributor(&setup.admin, &investor);
    assert!(client.is_contributor_frozen(&investor));

    // Unfreeze
    let result = client.try_unfreeze_contributor(&setup.admin, &investor);
    assert!(result.is_ok());

    // Check if investor is no longer frozen
    assert!(!client.is_contributor_frozen(&investor));
}

#[test]
fn test_unfreeze_contributor_unauthorized() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);
    let investor = setup.investors.get(0).unwrap();
    let unauthorized = Address::generate(&setup._env);

    // Freeze first
    client.freeze_contributor(&setup.admin, &investor);

    // Try to unfreeze with unauthorized account
    let result = client.try_unfreeze_contributor(&unauthorized, &investor);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_unfreeze_non_frozen_contributor_fails() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);
    let investor = setup.investors.get(0).unwrap();

    // Try to unfreeze a non-frozen contributor
    let result = client.try_unfreeze_contributor(&setup.admin, &investor);
    assert_eq!(result, Err(Ok(Error::NotFrozen)));
}

#[test]
fn test_frozen_contributor_cannot_receive_refund() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(2000); // Set time past deadline

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let platform = Address::generate(&env);
    let investor1 = Address::generate(&env);
    let investor2 = Address::generate(&env);

    let mut investors = Vec::new(&env);
    investors.push_back(investor1.clone());
    investors.push_back(investor2);

    let usdc_token = create_usdc_token(&env, &admin);
    let usdc = token::Client::new(&env, &usdc_token);

    let contract_id = env.register_contract(None, EscrowContract);
    let deal_value: i128 = 10_000_000_000;
    let milestone_count: u32 = 3;
    let funding_deadline: u64 = 1000; // Past timestamp

    EscrowContractClient::new(&env, &contract_id).initialize(
        &admin,
        &farmer,
        &platform,
        &usdc_token,
        &deal_value,
        &milestone_count,
        &investors,
        &funding_deadline,
    );

    // Fund the contract partially
    let amount: i128 = 5_000_000_000;
    usdc.mint(&investor1, &amount);
    EscrowContractClient::new(&env, &contract_id).fund(&investor1, &amount);

    // Freeze the investor
    EscrowContractClient::new(&env, &contract_id).freeze_contributor(&admin, &investor1);

    // Try to refund frozen investor
    let result = EscrowContractClient::new(&env, &contract_id)
        .try_refund_after_expiry(&investor1);
    assert_eq!(result, Err(Ok(Error::ContributorFrozen)));

    // Verify investor still has their original balance (no refund received)
    let balance = usdc.balance(&investor1);
    assert_eq!(balance, 0); // They had the amount, funded it, and didn't get it back
}

#[test]
fn test_unfrozen_contributor_can_receive_refund() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(2000); // Set time past deadline

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let platform = Address::generate(&env);
    let investor1 = Address::generate(&env);
    let investor2 = Address::generate(&env);

    let mut investors = Vec::new(&env);
    investors.push_back(investor1.clone());
    investors.push_back(investor2);

    let usdc_token = create_usdc_token(&env, &admin);
    let usdc = token::Client::new(&env, &usdc_token);

    let contract_id = env.register_contract(None, EscrowContract);
    let deal_value: i128 = 10_000_000_000;
    let milestone_count: u32 = 3;
    let funding_deadline: u64 = 1000; // Past timestamp

    EscrowContractClient::new(&env, &contract_id).initialize(
        &admin,
        &farmer,
        &platform,
        &usdc_token,
        &deal_value,
        &milestone_count,
        &investors,
        &funding_deadline,
    );

    // Fund the contract partially
    let amount: i128 = 5_000_000_000;
    usdc.mint(&investor1, &amount);
    EscrowContractClient::new(&env, &contract_id).fund(&investor1, &amount);

    // Freeze the investor
    EscrowContractClient::new(&env, &contract_id).freeze_contributor(&admin, &investor1);

    // Try to refund frozen investor (should fail)
    let result = EscrowContractClient::new(&env, &contract_id)
        .try_refund_after_expiry(&investor1);
    assert_eq!(result, Err(Ok(Error::ContributorFrozen)));

    // Unfreeze the investor
    EscrowContractClient::new(&env, &contract_id).unfreeze_contributor(&admin, &investor1);

    // Now refund should succeed
    let result = EscrowContractClient::new(&env, &contract_id)
        .refund_after_expiry(&investor1);
    assert!(result.is_ok());

    // Verify investor received refund
    let balance = usdc.balance(&investor1);
    assert_eq!(balance, amount);
}

#[test]
fn test_frozen_farmer_blocks_settlement() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);
    let total_funded: i128 = 10_000_000_000;

    fund_contract(&setup, total_funded);

    // Record all milestones
    client.record_milestone(&setup.admin, &0);
    client.record_milestone(&setup.admin, &1);
    client.record_milestone(&setup.admin, &2);

    // Freeze the farmer
    client.freeze_contributor(&setup.admin, &setup.farmer);

    // Try to settle with frozen farmer
    let result = client.try_settle_escrow(&setup.admin);
    assert_eq!(result, Err(Ok(Error::ContributorFrozen)));
}

#[test]
fn test_frozen_platform_blocks_settlement() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);
    let total_funded: i128 = 10_000_000_000;

    fund_contract(&setup, total_funded);

    // Record all milestones
    client.record_milestone(&setup.admin, &0);
    client.record_milestone(&setup.admin, &1);
    client.record_milestone(&setup.admin, &2);

    // Freeze the platform
    client.freeze_contributor(&setup.admin, &setup.platform);

    // Try to settle with frozen platform
    let result = client.try_settle_escrow(&setup.admin);
    assert_eq!(result, Err(Ok(Error::ContributorFrozen)));
}

#[test]
fn test_frozen_platform_blocks_legacy_release() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);
    let total_funded: i128 = 10_000_000_000;

    fund_contract(&setup, total_funded);

    client.approve_delivery(&setup.admin);

    // Freeze the platform
    client.freeze_contributor(&setup.admin, &setup.platform);

    // Try to release with frozen platform
    let result = client.try_release(&setup.admin);
    assert_eq!(result, Err(Ok(Error::ContributorFrozen)));
}

#[test]
fn test_batch_refund_skips_frozen_contributors() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(2000); // Set time past deadline

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let platform = Address::generate(&env);
    let investor1 = Address::generate(&env);
    let investor2 = Address::generate(&env);

    let mut investors = Vec::new(&env);
    investors.push_back(investor1.clone());
    investors.push_back(investor2.clone());

    let usdc_token = create_usdc_token(&env, &admin);
    let usdc = token::Client::new(&env, &usdc_token);

    let contract_id = env.register_contract(None, EscrowContract);
    let deal_value: i128 = 10_000_000_000;
    let milestone_count: u32 = 3;
    let funding_deadline: u64 = 1000; // Past timestamp

    EscrowContractClient::new(&env, &contract_id).initialize(
        &admin,
        &farmer,
        &platform,
        &usdc_token,
        &deal_value,
        &milestone_count,
        &investors,
        &funding_deadline,
    );

    // Fund the contract partially with multiple investors
    let amount1: i128 = 3_000_000_000;
    let amount2: i128 = 2_000_000_000;
    usdc.mint(&investor1, &amount1);
    usdc.mint(&investor2, &amount2);
    EscrowContractClient::new(&env, &contract_id).fund(&investor1, &amount1);
    EscrowContractClient::new(&env, &contract_id).fund(&investor2, &amount2);

    // Freeze investor1
    EscrowContractClient::new(&env, &contract_id).freeze_contributor(&admin, &investor1);

    let balance1_before = usdc.balance(&investor1);
    let balance2_before = usdc.balance(&investor2);

    // Batch refund all
    let result = EscrowContractClient::new(&env, &contract_id)
        .refund_all_after_expiry(&admin);
    assert!(result.is_ok());

    let balance1_after = usdc.balance(&investor1);
    let balance2_after = usdc.balance(&investor2);

    // Investor1 (frozen) should not receive refund
    assert_eq!(balance1_after - balance1_before, 0);
    
    // Investor2 (not frozen) should receive refund
    assert_eq!(balance2_after - balance2_before, amount2);

    // Verify total funded was reduced only by amount2
    let total_funded = EscrowContractClient::new(&env, &contract_id).get_total_funded();
    assert_eq!(total_funded, amount1); // Only frozen investor's funds remain
}

#[test]
fn test_settlement_succeeds_after_unfreeze() {
    let setup = setup();
    let client = EscrowContractClient::new(&setup._env, &setup.contract_id);
    let total_funded: i128 = 10_000_000_000;

    fund_contract(&setup, total_funded);

    // Record all milestones
    client.record_milestone(&setup.admin, &0);
    client.record_milestone(&setup.admin, &1);
    client.record_milestone(&setup.admin, &2);

    // Freeze the farmer
    client.freeze_contributor(&setup.admin, &setup.farmer);

    // Try to settle with frozen farmer (should fail)
    let result = client.try_settle_escrow(&setup.admin);
    assert_eq!(result, Err(Ok(Error::ContributorFrozen)));

    // Unfreeze the farmer
    client.unfreeze_contributor(&setup.admin, &setup.farmer);

    // Now settlement should succeed
    let result = client.try_settle_escrow(&setup.admin);
    assert!(result.is_ok());
}
