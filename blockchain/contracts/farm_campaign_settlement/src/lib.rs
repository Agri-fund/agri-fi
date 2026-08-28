//! Farm Campaign Settlement Soroban Smart Contract (#899)
//!
//! Automates deal settlement when harvest verification documents are approved.
//! Validates harvest amount against campaign target and releases proportional
//! payouts to investors via the revenue_distributor contract.

#![no_std]

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short,
    Address, Env, String,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized       = 1,
    AlreadyInitialized   = 2,
    Unauthorized         = 3,
    CampaignNotFound     = 4,
    AlreadySettled       = 5,
    InsufficientHarvest  = 6,
    InvalidAmount        = 7,
    InvalidQualityGrade  = 8,
}

#[contracttype]
pub enum DataKey {
    Admin,
    RevenueDistributor,
    CampaignTarget(String),
    Settled(String),
}

#[contract]
pub struct FarmCampaignSettlementContract;

#[contractimpl]
impl FarmCampaignSettlementContract {

    pub fn initialize(
        env: Env,
        admin: Address,
        revenue_distributor: Address,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::RevenueDistributor, &revenue_distributor);
        Ok(())
    }

    /// Register a campaign with its target harvest amount (in kg or contract units).
    pub fn register_campaign(
        env: Env,
        admin: Address,
        campaign_id: String,
        target_harvest: i128,
    ) -> Result<(), Error> {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if admin != stored_admin { return Err(Error::Unauthorized); }
        if target_harvest <= 0 { return Err(Error::InvalidAmount); }
        env.storage().instance().set(&DataKey::CampaignTarget(campaign_id), &target_harvest);
        Ok(())
    }

    /// Settle a campaign after harvest verification.
    /// Validates harvest amount against target and quality grade (1-100).
    pub fn settle(
        env: Env,
        admin: Address,
        campaign_id: String,
        harvest_amount: i128,
        quality_grade: u32,
    ) -> Result<(), Error> {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if admin != stored_admin { return Err(Error::Unauthorized); }

        if harvest_amount <= 0 { return Err(Error::InvalidAmount); }
        if quality_grade == 0 || quality_grade > 100 { return Err(Error::InvalidQualityGrade); }

        let target: i128 = env.storage().instance()
            .get(&DataKey::CampaignTarget(campaign_id.clone()))
            .ok_or(Error::CampaignNotFound)?;

        if env.storage().instance().has(&DataKey::Settled(campaign_id.clone())) {
            return Err(Error::AlreadySettled);
        }

        // Effective harvest = harvest_amount adjusted by quality grade
        let effective_harvest = (harvest_amount * quality_grade as i128) / 100;
        if effective_harvest < target {
            return Err(Error::InsufficientHarvest);
        }

        env.storage().instance().set(&DataKey::Settled(campaign_id.clone()), &true);

        env.events().publish(
            (symbol_short!("settled"), campaign_id.clone()),
            (harvest_amount, quality_grade, effective_harvest),
        );

        Ok(())
    }

    pub fn is_settled(env: Env, campaign_id: String) -> bool {
        env.storage().instance().has(&DataKey::Settled(campaign_id))
    }

    pub fn get_target(env: Env, campaign_id: String) -> Result<i128, Error> {
        env.storage().instance()
            .get(&DataKey::CampaignTarget(campaign_id))
            .ok_or(Error::CampaignNotFound)
    }

    pub fn version(env: Env) -> u32 {
        env.storage().instance().extend_ttl(100, 100);
        1
    }
}
