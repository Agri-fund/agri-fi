//! ProjectFactory Soroban Smart Contract
//! Registry of all deployed FarmCampaign contracts.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short,
    Address, Env, String,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    Unauthorized      = 1,
    AlreadyRegistered = 2,
    NotFound          = 3,
    NotInitialized    = 4,
}

#[contracttype]
pub enum DataKey {
    Admin,
    CampaignCount,
    Campaign(String),
}

#[contracttype]
#[derive(Clone)]
pub struct CampaignEntry {
    pub contract_address: Address,
    pub farmer: Address,
    pub commodity: String,
    pub registered_at: u64,
}

#[contract]
pub struct ProjectFactoryContract;

#[contractimpl]
impl ProjectFactoryContract {

    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyRegistered);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::CampaignCount, &0u32);
        Ok(())
    }

    pub fn register_campaign(
        env: Env,
        admin: Address,
        deal_id: String,
        contract_address: Address,
        farmer: Address,
        commodity: String,
    ) -> Result<(), Error> {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if admin != stored_admin { return Err(Error::Unauthorized); }

        let key = DataKey::Campaign(deal_id.clone());
        if env.storage().instance().has(&key) { return Err(Error::AlreadyRegistered); }

        let entry = CampaignEntry {
            contract_address: contract_address.clone(),
            farmer,
            commodity,
            registered_at: env.ledger().timestamp(),
        };
        env.storage().instance().set(&key, &entry);

        let count: u32 = env.storage().instance().get(&DataKey::CampaignCount).unwrap_or(0);
        env.storage().instance().set(&DataKey::CampaignCount, &(count + 1));
        env.events().publish((symbol_short!("campaign"), deal_id), contract_address);
        Ok(())
    }

    pub fn get_campaign(env: Env, deal_id: String) -> Result<CampaignEntry, Error> {
        env.storage().instance().get(&DataKey::Campaign(deal_id)).ok_or(Error::NotFound)
    }

    pub fn get_campaign_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::CampaignCount).unwrap_or(0)
    }

    pub fn update_admin(env: Env, current_admin: Address, new_admin: Address) -> Result<(), Error> {
        current_admin.require_auth();
        let stored: Address = env.storage().instance().get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if current_admin != stored { return Err(Error::Unauthorized); }
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Ok(())
    }
}
