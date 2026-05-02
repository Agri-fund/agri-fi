//! RevenueDistributor Soroban Smart Contract

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short,
    Address, Env, Vec, token,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    Unauthorized     = 1,
    InvalidShares    = 2,
    InvalidAmount    = 3,
    AlreadyProcessed = 4,
    NotInitialized   = 5,
}

#[contracttype]
pub enum DataKey {
    Admin,
    UsdcToken,
    DistributionCount,
}

#[contracttype]
#[derive(Clone)]
pub struct Recipient {
    pub address: Address,
    pub share_bps: u32,
}

#[contract]
pub struct RevenueDistributorContract;

#[contractimpl]
impl RevenueDistributorContract {

    pub fn initialize(env: Env, admin: Address, usdc_token: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyProcessed);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::UsdcToken, &usdc_token);
        env.storage().instance().set(&DataKey::DistributionCount, &0u32);
        Ok(())
    }

    /// Distribute `total_amount` USDC to recipients. Shares must sum to 10000 bps.
    pub fn distribute(
        env: Env,
        caller: Address,
        recipients: Vec<Recipient>,
        total_amount: i128,
    ) -> Result<(), Error> {
        caller.require_auth();
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if caller != admin { return Err(Error::Unauthorized); }
        if total_amount <= 0 { return Err(Error::InvalidAmount); }

        let total_bps: u32 = recipients.iter().map(|r| r.share_bps).sum();
        if total_bps != 10_000 { return Err(Error::InvalidShares); }

        let usdc_token: Address = env.storage().instance().get(&DataKey::UsdcToken)
            .ok_or(Error::NotInitialized)?;
        let usdc = token::Client::new(&env, &usdc_token);

        let mut distributed: i128 = 0;
        let count = recipients.len();

        for (i, recipient) in recipients.iter().enumerate() {
            let amount = if i == (count as usize) - 1 {
                total_amount - distributed
            } else {
                (total_amount * recipient.share_bps as i128) / 10_000
            };
            if amount > 0 {
                usdc.transfer(&env.current_contract_address(), &recipient.address, &amount);
                env.events().publish((symbol_short!("paid"), recipient.address.clone()), amount);
                distributed += amount;
            }
        }

        let prev: u32 = env.storage().instance().get(&DataKey::DistributionCount).unwrap_or(0);
        env.storage().instance().set(&DataKey::DistributionCount, &(prev + 1));
        env.events().publish((symbol_short!("distrib"),), total_amount);
        Ok(())
    }

    pub fn get_distribution_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::DistributionCount).unwrap_or(0)
    }
}
