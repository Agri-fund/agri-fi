#![no_std]

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short,
    Address, BytesN, Env, token,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    Unauthorized        = 1,
    NotInitialized      = 2,
    AlreadyInitialized  = 3,
    InvalidAmount       = 4,
    InvalidShares       = 5,
    AlreadyReleased     = 6,
    BalanceInsufficient = 7,
    DeliveryNotApproved = 8,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Farmer,
    Platform,
    UsdcToken,
    TotalFunded,
    Released,
    DeliveryApproved,
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        farmer: Address,
        platform: Address,
        usdc_token: Address,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Farmer, &farmer);
        env.storage().instance().set(&DataKey::Platform, &platform);
        env.storage().instance().set(&DataKey::UsdcToken, &usdc_token);
        env.storage().instance().set(&DataKey::TotalFunded, &0i128);
        env.storage().instance().set(&DataKey::Released, &false);
        env.storage().instance().set(&DataKey::DeliveryApproved, &false);
        Ok(())
    }

    pub fn fund(env: Env, caller: Address, amount: i128) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let usdc_token: Address = env
            .storage()
            .instance()
            .get(&DataKey::UsdcToken)
            .unwrap();
        let usdc = token::Client::new(&env, &usdc_token);

        caller.require_auth();
        usdc.transfer(&caller, &env.current_contract_address(), &amount);

        let prev: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalFunded)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalFunded, &(prev + amount));
        env.events()
            .publish((symbol_short!("funded"),), amount);
        Ok(())
    }

    pub fn approve_delivery(env: Env, caller: Address) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap();
        caller.require_auth();
        if caller != admin {
            return Err(Error::Unauthorized);
        }
        env.storage()
            .instance()
            .set(&DataKey::DeliveryApproved, &true);
        env.events()
            .publish((symbol_short!("approve"),), true);
        Ok(())
    }

    pub fn submit_delivery_milestone(env: Env, caller: Address) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap();
        let farmer: Address = env
            .storage()
            .instance()
            .get(&DataKey::Farmer)
            .unwrap();
        caller.require_auth();
        if caller != admin && caller != farmer {
            return Err(Error::Unauthorized);
        }

        env.storage()
            .instance()
            .set(&DataKey::DeliveryApproved, &true);
        env.events()
            .publish((symbol_short!("milestone"),), true);
        Ok(())
    }

    pub fn release(env: Env, caller: Address) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }
        caller.require_auth();
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap();
        if caller != admin {
            return Err(Error::Unauthorized);
        }

        if env.storage().instance().get(&DataKey::Released).unwrap_or(false) {
            return Err(Error::AlreadyReleased);
        }

        let delivery_approved: bool = env
            .storage()
            .instance()
            .get(&DataKey::DeliveryApproved)
            .unwrap_or(false);
        if !delivery_approved {
            return Err(Error::DeliveryNotApproved);
        }

        let total_funded: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalFunded)
            .unwrap_or(0);
        if total_funded <= 0 {
            return Err(Error::BalanceInsufficient);
        }

        let farmer: Address = env
            .storage()
            .instance()
            .get(&DataKey::Farmer)
            .unwrap();
        let platform: Address = env
            .storage()
            .instance()
            .get(&DataKey::Platform)
            .unwrap();
        let usdc_token: Address = env
            .storage()
            .instance()
            .get(&DataKey::UsdcToken)
            .unwrap();
        let usdc = token::Client::new(&env, &usdc_token);

        let farmer_amount = (total_funded * 98) / 100;
        let platform_amount = total_funded - farmer_amount;

        if farmer_amount > 0 {
            usdc.transfer(
                &env.current_contract_address(),
                &farmer,
                &farmer_amount,
            );
        }
        if platform_amount > 0 {
            usdc.transfer(
                &env.current_contract_address(),
                &platform,
                &platform_amount,
            );
        }

        env.storage()
            .instance()
            .set(&DataKey::Released, &true);
        env.events()
            .publish((symbol_short!("release"),), total_funded);
        Ok(())
    }

    /// Upgrades the contract WASM bytecode to a new version.
    /// Only the admin account can invoke this function.
    /// The `new_wasm_hash` is the hash of the new compiled WASM blob.
    pub fn upgrade(env: Env, caller: Address, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }
        caller.require_auth();
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap();
        if caller != admin {
            return Err(Error::Unauthorized);
        }
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        env.events()
            .publish((symbol_short!("upgrade"),), true);
        Ok(())
    }

    pub fn get_total_funded(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalFunded)
            .unwrap_or(0)
    }

    pub fn is_released(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Released)
            .unwrap_or(false)
    }

    pub fn is_delivery_approved(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::DeliveryApproved)
            .unwrap_or(false)
    }
}
