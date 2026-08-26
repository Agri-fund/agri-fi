//! ProjectFactory Soroban Smart Contract
//! Registry of all deployed FarmCampaign contracts.

#![no_std]

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short,
    Address, Bytes, BytesN, Env, String,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    Unauthorized      = 1,
    AlreadyRegistered = 2,
    NotFound          = 3,
    NotInitialized    = 4,
    WasmHashNotSet    = 5,
}

#[contracttype]
pub enum DataKey {
    Admin,
    CampaignWasmHash,
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

    /// Stores the FarmCampaign WASM hash used by `deploy` (#830).
    pub fn set_campaign_wasm_hash(
        env: Env,
        admin: Address,
        wasm_hash: BytesN<32>,
    ) -> Result<(), Error> {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if admin != stored_admin { return Err(Error::Unauthorized); }
        env.storage().instance().set(&DataKey::CampaignWasmHash, &wasm_hash);
        Ok(())
    }

    pub fn get_campaign_wasm_hash(env: Env) -> Result<BytesN<32>, Error> {
        env.storage().instance().get(&DataKey::CampaignWasmHash).ok_or(Error::WasmHashNotSet)
    }

    /// Deploys a new FarmCampaign contract and returns its address (#830).
    pub fn deploy(
        env: Env,
        admin: Address,
        farmer: Address,
        target_amount: i128,
        duration_ledgers: u32,
        commodity_code: String,
    ) -> Result<Address, Error> {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if admin != stored_admin { return Err(Error::Unauthorized); }

        let wasm_hash: BytesN<32> = env.storage().instance()
            .get(&DataKey::CampaignWasmHash)
            .ok_or(Error::WasmHashNotSet)?;

        let count: u32 = env.storage().instance().get(&DataKey::CampaignCount).unwrap_or(0);

        // Unique salt derived from the campaign count, current ledger time and
        // deal parameters so every deploy yields a fresh contract address.
        let mut seed = Bytes::new(&env);
        seed.extend_from_array(&count.to_be_bytes());
        seed.extend_from_array(&env.ledger().timestamp().to_be_bytes());
        seed.extend_from_array(&target_amount.to_be_bytes());
        seed.extend_from_array(&duration_ledgers.to_be_bytes());
        let salt: BytesN<32> = env.crypto().sha256(&seed).into();

        let campaign_address: Address = env.deployer().create_contract(wasm_hash, salt);

        let updated = count + 1;
        env.storage().instance().set(&DataKey::CampaignCount, &updated);
        env.events().publish(
            (symbol_short!("deployed"), farmer.clone()),
            campaign_address.clone(),
        );
        Ok(campaign_address)
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
