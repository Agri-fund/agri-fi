#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

struct Setup {
    env: Env,
    contract_id: Address,
    admin: Address,
    farmer: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);

    let contract_id = env.register_contract(None, ProjectFactoryContract);
    ProjectFactoryContractClient::new(&env, &contract_id).initialize(&admin);

    Setup {
        env,
        contract_id,
        admin,
        farmer,
    }
}

#[test]
fn test_initialize() {
    let setup = setup();
    let client = ProjectFactoryContractClient::new(&setup.env, &setup.contract_id);
    
    // Verify campaign count starts at 0
    assert_eq!(client.get_campaign_count(), 0);
}

#[test]
fn test_initialize_twice_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, ProjectFactoryContract);
    let client = ProjectFactoryContractClient::new(&env, &contract_id);
    
    // First initialization should succeed
    client.initialize(&admin);
    
    // Second initialization should fail
    let result = client.try_initialize(&admin);
    assert_eq!(result, Err(Ok(Error::AlreadyRegistered)));
}

#[test]
fn test_register_campaign() {
    let setup = setup();
    let client = ProjectFactoryContractClient::new(&setup.env, &setup.contract_id);
    
    let deal_id = String::from_str(&setup.env, "deal_001");
    let contract_address = Address::generate(&setup.env);
    let commodity = String::from_str(&setup.env, "wheat");
    
    client.register_campaign(
        &setup.admin,
        &deal_id.clone(),
        &contract_address.clone(),
        &setup.farmer,
        &commodity,
    );
    
    // Verify campaign was registered
    let campaign = client.get_campaign(&deal_id).unwrap();
    assert_eq!(campaign.contract_address, contract_address);
    assert_eq!(campaign.farmer, setup.farmer);
    assert_eq!(campaign.commodity, commodity);
    assert_eq!(client.get_campaign_count(), 1);
}

#[test]
fn test_register_campaign_unauthorized_fails() {
    let setup = setup();
    let client = ProjectFactoryContractClient::new(&setup.env, &setup.contract_id);
    
    let unauthorized = Address::generate(&setup.env);
    let deal_id = String::from_str(&setup.env, "deal_001");
    let contract_address = Address::generate(&setup.env);
    let commodity = String::from_str(&setup.env, "wheat");
    
    let result = client.try_register_campaign(
        &unauthorized,
        &deal_id,
        &contract_address,
        &setup.farmer,
        &commodity,
    );
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_register_same_campaign_twice_fails() {
    let setup = setup();
    let client = ProjectFactoryContractClient::new(&setup.env, &setup.contract_id);
    
    let deal_id = String::from_str(&setup.env, "deal_001");
    let contract_address = Address::generate(&setup.env);
    let commodity = String::from_str(&setup.env, "wheat");
    
    // First registration
    client.register_campaign(
        &setup.admin,
        &deal_id.clone(),
        &contract_address,
        &setup.farmer,
        &commodity.clone(),
    );
    
    // Second registration with same deal_id should fail
    let result = client.try_register_campaign(
        &setup.admin,
        &deal_id,
        &contract_address,
        &setup.farmer,
        &commodity,
    );
    assert_eq!(result, Err(Ok(Error::AlreadyRegistered)));
}

#[test]
fn test_get_campaign_not_found() {
    let setup = setup();
    let client = ProjectFactoryContractClient::new(&setup.env, &setup.contract_id);
    
    let deal_id = String::from_str(&setup.env, "nonexistent");
    let result = client.get_campaign(&deal_id);
    assert_eq!(result, Err(Ok(Error::NotFound)));
}

#[test]
fn test_register_multiple_campaigns() {
    let setup = setup();
    let client = ProjectFactoryContractClient::new(&setup.env, &setup.contract_id);
    
    // Register first campaign
    let deal_id_1 = String::from_str(&setup.env, "deal_001");
    let contract_address_1 = Address::generate(&setup.env);
    let commodity_1 = String::from_str(&setup.env, "wheat");
    
    client.register_campaign(
        &setup.admin,
        &deal_id_1,
        &contract_address_1,
        &setup.farmer,
        &commodity_1,
    );
    
    // Register second campaign
    let deal_id_2 = String::from_str(&setup.env, "deal_002");
    let contract_address_2 = Address::generate(&setup.env);
    let commodity_2 = String::from_str(&setup.env, "corn");
    let farmer_2 = Address::generate(&setup.env);
    
    client.register_campaign(
        &setup.admin,
        &deal_id_2,
        &contract_address_2,
        &farmer_2,
        &commodity_2,
    );
    
    // Verify both campaigns are registered
    assert_eq!(client.get_campaign_count(), 2);
    
    let campaign_1 = client.get_campaign(&deal_id_1).unwrap();
    assert_eq!(campaign_1.contract_address, contract_address_1);
    assert_eq!(campaign_1.commodity, commodity_1);
    
    let campaign_2 = client.get_campaign(&deal_id_2).unwrap();
    assert_eq!(campaign_2.contract_address, contract_address_2);
    assert_eq!(campaign_2.commodity, commodity_2);
}

#[test]
fn test_update_admin() {
    let setup = setup();
    let client = ProjectFactoryContractClient::new(&setup.env, &setup.contract_id);
    
    let new_admin = Address::generate(&setup.env);
    client.update_admin(&setup.admin, &new_admin.clone());
    
    // Verify new admin can register campaigns
    let deal_id = String::from_str(&setup.env, "deal_001");
    let contract_address = Address::generate(&setup.env);
    let commodity = String::from_str(&setup.env, "wheat");
    
    client.register_campaign(
        &new_admin,
        &deal_id,
        &contract_address,
        &setup.farmer,
        &commodity,
    );
    
    assert_eq!(client.get_campaign_count(), 1);
}

#[test]
fn test_update_admin_unauthorized_fails() {
    let setup = setup();
    let client = ProjectFactoryContractClient::new(&setup.env, &setup.contract_id);
    
    let unauthorized = Address::generate(&setup.env);
    let new_admin = Address::generate(&setup.env);
    
    let result = client.try_update_admin(&unauthorized, &new_admin);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_update_admin_not_initialized_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, ProjectFactoryContract);
    let client = ProjectFactoryContractClient::new(&env, &contract_id);
    
    // Try to update admin without initializing
    let new_admin = Address::generate(&env);
    let result = client.try_update_admin(&admin, &new_admin);
    assert_eq!(result, Err(Ok(Error::NotInitialized)));
}

#[test]
fn test_campaign_entry_timestamp() {
    let setup = setup();
    let client = ProjectFactoryContractClient::new(&setup.env, &setup.contract_id);
    
    let deal_id = String::from_str(&setup.env, "deal_001");
    let contract_address = Address::generate(&setup.env);
    let commodity = String::from_str(&setup.env, "wheat");
    
    let before_timestamp = setup.env.ledger().timestamp();
    
    client.register_campaign(
        &setup.admin,
        &deal_id,
        &contract_address,
        &setup.farmer,
        &commodity,
    );
    
    let campaign = client.get_campaign(&deal_id).unwrap();
    assert!(campaign.registered_at >= before_timestamp);
}

#[test]
fn test_register_campaign_without_initialization_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, ProjectFactoryContract);
    let client = ProjectFactoryContractClient::new(&env, &contract_id);
    
    // Try to register without initializing
    let deal_id = String::from_str(&env, "deal_001");
    let contract_address = Address::generate(&env);
    let farmer = Address::generate(&env);
    let commodity = String::from_str(&env, "wheat");
    
    let result = client.try_register_campaign(
        &admin,
        &deal_id,
        &contract_address,
        &farmer,
        &commodity,
    );
    assert_eq!(result, Err(Ok(Error::NotInitialized)));
}
