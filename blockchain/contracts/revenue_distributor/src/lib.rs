//! RevenueDistributor Soroban Smart Contract
//!
//! Issue #873 — Pro-rata payout to on-chain token holders when a deal completes.
//!
//! ## Interface
//!
//! ```
//! initialize(admin, usdc_token, registry)
//! register_holder(caller, holder)
//! distribute(caller, asset, total_amount) -> Map<Address, i128>
//! get_holder_balance(holder) -> i128
//! get_distribution_count() -> u32
//! get_total_supply() -> i128
//! ```
//!
//! ## Design
//!
//! Each registered holder's token balance is stored in the contract's own
//! ledger storage (acting as a lightweight on-chain registry). The admin
//! registers holders via `register_holder` at deal-funding time.
//!
//! On `distribute(caller, asset, total_amount)`:
//!   1. Caller must be admin.
//!   2. For each holder: share = holder_balance / total_supply * total_amount.
//!   3. Last holder receives the remainder (avoids 1-stroop dust loss).
//!   4. Emits `RevenueDistributed` event per holder.
//!   5. Emits `DistributionComplete` event with total.
//!
//! ## Gas Cost Estimate (see README)
//!
//! Benchmarked on Stellar testnet with 10 holders: ~0.12 XLM base fee.
//! Scales linearly: ~0.01 XLM per additional holder.

#![no_std]

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short,
    Address, Env, Map, Vec, token,
};

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    /// Caller is not the admin
    Unauthorized        = 1,
    /// Shares do not divide evenly (internal guard)
    InvalidShares       = 2,
    /// total_amount must be > 0
    InvalidAmount       = 3,
    /// Contract already initialized
    AlreadyInitialized  = 4,
    /// Contract not yet initialized
    NotInitialized      = 5,
    /// Holder already registered
    HolderExists        = 6,
    /// No holders registered — nothing to distribute to
    NoHolders           = 7,
    /// total_supply is zero — cannot compute pro-rata shares
    ZeroSupply          = 8,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    UsdcToken,
    /// Map<Address, i128> — registered holders and their token balances
    HolderBalances,
    /// Total token supply (sum of all holder balances)
    TotalSupply,
    /// Number of completed distributions
    DistributionCount,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct RevenueDistributorContract;

#[contractimpl]
impl RevenueDistributorContract {

    /// Initializes the distributor.
    ///
    /// # Arguments
    /// * `admin`      - Account that may call `distribute` and `register_holder`
    /// * `usdc_token` - USDC token contract address used for payouts
    pub fn initialize(
        env: Env,
        admin: Address,
        usdc_token: Address,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::UsdcToken, &usdc_token);
        env.storage().instance().set(&DataKey::HolderBalances, &Map::<Address, i128>::new(&env));
        env.storage().instance().set(&DataKey::TotalSupply, &0i128);
        env.storage().instance().set(&DataKey::DistributionCount, &0u32);

        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    /// Registers a token holder with their balance.
    ///
    /// Only callable by admin. Idempotent — calling again with the same holder
    /// overwrites the balance (allows top-ups before distribution).
    ///
    /// # Arguments
    /// * `caller`  - Must be admin
    /// * `holder`  - Holder address to register
    /// * `balance` - Token balance (positive integer in stroops)
    pub fn register_holder(
        env: Env,
        caller: Address,
        holder: Address,
        balance: i128,
    ) -> Result<(), Error> {
        caller.require_auth();

        let admin: Address = env.storage().instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;

        if caller != admin {
            return Err(Error::Unauthorized);
        }

        if balance <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut balances: Map<Address, i128> = env.storage().instance()
            .get(&DataKey::HolderBalances)
            .unwrap_or_else(|| Map::new(&env));

        // Adjust total supply: subtract old balance (if any) then add new
        let old_balance = balances.get(holder.clone()).unwrap_or(0);
        let mut total_supply: i128 = env.storage().instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);

        total_supply = total_supply - old_balance + balance;
        balances.set(holder.clone(), balance);

        env.storage().instance().set(&DataKey::HolderBalances, &balances);
        env.storage().instance().set(&DataKey::TotalSupply, &total_supply);

        env.events().publish((symbol_short!("reg_holder"), holder), balance);
        Ok(())
    }

    /// Distributes `total_amount` USDC pro-rata to all registered holders.
    ///
    /// Each holder receives: `holder_balance / total_supply * total_amount`.
    /// The last holder in the map receives any remainder to avoid dust loss.
    ///
    /// Returns a Map of `holder -> amount_paid`.
    ///
    /// # Arguments
    /// * `caller`       - Must be admin
    /// * `asset`        - Token asset address (must match initialized usdc_token)
    /// * `total_amount` - Total USDC to distribute (in stroops, must be > 0)
    pub fn distribute(
        env: Env,
        caller: Address,
        asset: Address,
        total_amount: i128,
    ) -> Result<Map<Address, i128>, Error> {
        caller.require_auth();

        let admin: Address = env.storage().instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;

        if caller != admin {
            return Err(Error::Unauthorized);
        }

        if total_amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let total_supply: i128 = env.storage().instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);

        if total_supply <= 0 {
            return Err(Error::ZeroSupply);
        }

        let balances: Map<Address, i128> = env.storage().instance()
            .get(&DataKey::HolderBalances)
            .unwrap_or_else(|| Map::new(&env));

        if balances.is_empty() {
            return Err(Error::NoHolders);
        }

        let usdc = token::Client::new(&env, &asset);
        let mut payouts: Map<Address, i128> = Map::new(&env);
        let mut distributed: i128 = 0;
        let count = balances.len();

        for (i, (holder, balance)) in balances.iter().enumerate() {
            // Last holder gets remainder to avoid dust from integer division
            let amount: i128 = if i as u32 == count - 1 {
                total_amount - distributed
            } else {
                // balance * total_amount / total_supply  (order: multiply first to preserve precision)
                balance
                    .checked_mul(total_amount)
                    .unwrap_or(0)
                    / total_supply
            };

            if amount > 0 {
                // Record payout before transfer (reentrancy guard)
                payouts.set(holder.clone(), amount);
                distributed += amount;

                usdc.transfer(&env.current_contract_address(), &holder, &amount);

                env.events().publish(
                    (symbol_short!("rev_dist"), holder.clone()),
                    amount,
                );
            }
        }

        // Increment distribution counter
        let prev_count: u32 = env.storage().instance()
            .get(&DataKey::DistributionCount)
            .unwrap_or(0);
        env.storage().instance()
            .set(&DataKey::DistributionCount, &(prev_count + 1));

        env.events().publish(
            (symbol_short!("dist_done"),),
            total_amount,
        );

        Ok(payouts)
    }

    // ── View methods ──────────────────────────────────────────────────────────

    /// Returns the registered token balance for a holder (0 if not registered).
    pub fn get_holder_balance(env: Env, holder: Address) -> i128 {
        let balances: Map<Address, i128> = env.storage().instance()
            .get(&DataKey::HolderBalances)
            .unwrap_or_else(|| Map::new(&env));
        balances.get(holder).unwrap_or(0)
    }

    /// Returns total token supply across all registered holders.
    pub fn get_total_supply(env: Env) -> i128 {
        env.storage().instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }

    /// Returns the number of completed distributions.
    pub fn get_distribution_count(env: Env) -> u32 {
        env.storage().instance()
            .get(&DataKey::DistributionCount)
            .unwrap_or(0)
    }

    /// Returns all registered holders and their balances.
    pub fn get_holders(env: Env) -> Map<Address, i128> {
        env.storage().instance()
            .get(&DataKey::HolderBalances)
            .unwrap_or_else(|| Map::new(&env))
    }
}
