#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Env, String};

fn setup() -> (Env, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let revenue_distributor = Address::generate(&env);
    let contract_id = env.register_contract(None, FarmCampaignSettlementContract);

    FarmCampaignSettlementContractClient::new(&env, &contract_id)
        .initialize(&admin, &revenue_distributor);

    (env, contract_id, admin, revenue_distributor)
}

#[test]
fn test_settle_happy_path() {
    let (env, contract_id, admin, _) = setup();
    let client = FarmCampaignSettlementContractClient::new(&env, &contract_id);

    let campaign_id = String::from_str(&env, "campaign-001");
    let target: i128 = 10_000;

    client.register_campaign(&admin, &campaign_id, &target);

    // harvest 12_000 kg at 90% quality => effective 10_800 >= target
    client.settle(&admin, &campaign_id, &12_000, &90);

    assert!(client.is_settled(&campaign_id));
}

#[test]
fn test_settle_insufficient_harvest() {
    let (env, contract_id, admin, _) = setup();
    let client = FarmCampaignSettlementContractClient::new(&env, &contract_id);

    let campaign_id = String::from_str(&env, "campaign-002");
    let target: i128 = 10_000;

    client.register_campaign(&admin, &campaign_id, &target);

    // harvest 8_000 kg at 80% quality => effective 6_400 < target
    let result = client.try_settle(&admin, &campaign_id, &8_000, &80);
    assert_eq!(result, Err(Ok(Error::InsufficientHarvest)));
    assert!(!client.is_settled(&campaign_id));
}

#[test]
fn test_settle_idempotent_rejection() {
    let (env, contract_id, admin, _) = setup();
    let client = FarmCampaignSettlementContractClient::new(&env, &contract_id);

    let campaign_id = String::from_str(&env, "campaign-003");
    client.register_campaign(&admin, &campaign_id, &5_000);
    client.settle(&admin, &campaign_id, &6_000, &100);

    let result = client.try_settle(&admin, &campaign_id, &6_000, &100);
    assert_eq!(result, Err(Ok(Error::AlreadySettled)));
}

#[test]
fn test_unauthorized_settle() {
    let (env, contract_id, admin, _) = setup();
    let client = FarmCampaignSettlementContractClient::new(&env, &contract_id);

    let campaign_id = String::from_str(&env, "campaign-004");
    client.register_campaign(&admin, &campaign_id, &5_000);

    let other = Address::generate(&env);
    let result = client.try_settle(&other, &campaign_id, &6_000, &100);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}
