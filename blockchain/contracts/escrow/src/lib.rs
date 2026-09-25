#![no_std]

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short,
    Address, BytesN, Env, token, Vec, Map,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    Unauthorized              = 1,
    NotInitialized            = 2,
    AlreadyInitialized        = 3,
    InvalidAmount             = 4,
    InvalidShares             = 5,
    AlreadyReleased           = 6,
    BalanceInsufficient       = 7,
    DeliveryNotApproved       = 8,
    InvalidMilestones         = 9,
    MilestoneAlreadyRecorded  = 10,
    InsufficientMilestonesCompleted = 11,
    NoInvestors               = 12,
    DeadlineNotPassed         = 13,
    TargetMet                 = 14,
    NothingToRefund           = 15,
    ContributorFrozen         = 16,
    NotFrozen                 = 17,
}

/// Milestone data structure tracking completion status and details
#[contracttype]
#[derive(Clone, Debug)]
pub struct Milestone {
    pub id: u32,
    pub completed: bool,
    pub timestamp: u64,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Farmer,
    Platform,
    UsdcToken,
    DealValue,           // Total deal value in USDC
    TotalFunded,
    Released,
    DeliveryApproved,
    MilestonesCount,     // Total number of milestones for this deal
    MilestonesCompleted, // Number of completed milestones
    Investors,           // Map of investor addresses to their investment amounts
    MilestoneData,       // Map of milestone ID to Milestone struct
    FundingDeadline,     // Unix timestamp for funding deadline
    Refunded,            // Map of investor addresses to their refund status
    FrozenContributors,  // Map of frozen contributor addresses
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Initializes the escrow contract with deal parameters.
    /// Issue #345 — Soroban smart contract for automatic escrow settlement.
    ///
    /// # Arguments
    /// * `admin` - Admin account that can approve milestones and release funds
    /// * `farmer` - Recipient farmer account
    /// * `platform` - Platform fee account
    /// * `usdc_token` - USDC token contract address
    /// * `deal_value` - Total deal value in USDC stroops
    /// * `milestone_count` - Total number of milestones to complete
    /// * `investors` - List of investor addresses
    /// * `funding_deadline` - Unix timestamp for funding deadline
    pub fn initialize(
        env: Env,
        admin: Address,
        farmer: Address,
        platform: Address,
        usdc_token: Address,
        deal_value: i128,
        milestone_count: u32,
        investors: Vec<Address>,
        funding_deadline: u64,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }

        if deal_value <= 0 {
            return Err(Error::InvalidAmount);
        }

        if milestone_count == 0 {
            return Err(Error::InvalidMilestones);
        }

        if investors.is_empty() {
            return Err(Error::NoInvestors);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Farmer, &farmer);
        env.storage().instance().set(&DataKey::Platform, &platform);
        env.storage().instance().set(&DataKey::UsdcToken, &usdc_token);
        env.storage().instance().set(&DataKey::DealValue, &deal_value);
        env.storage().instance().set(&DataKey::TotalFunded, &0i128);
        env.storage().instance().set(&DataKey::Released, &false);
        env.storage().instance().set(&DataKey::DeliveryApproved, &false);
        env.storage().instance().set(&DataKey::MilestonesCount, &milestone_count);
        env.storage().instance().set(&DataKey::MilestonesCompleted, &0u32);
        env.storage().instance().set(&DataKey::FundingDeadline, &funding_deadline);

        // Store investors as a Map for O(1) lookups and better gas efficiency
        let investors_map: Map<Address, i128> = Map::new(&env);
        for investor in investors.iter() {
            investors_map.set(investor, 0i128);
        }
        env.storage().instance().set(&DataKey::Investors, &investors_map);

        // Initialize empty milestone data map
        let milestone_map: Map<u32, Milestone> = Map::new(&env);
        env.storage().instance().set(&DataKey::MilestoneData, &milestone_map);

        // Initialize empty refund tracking map
        let refunded_map: Map<Address, bool> = Map::new(&env);
        env.storage().instance().set(&DataKey::Refunded, &refunded_map);

        // Initialize empty frozen contributors map
        let frozen_map: Map<Address, bool> = Map::new(&env);
        env.storage().instance().set(&DataKey::FrozenContributors, &frozen_map);

        env.events()
            .publish((symbol_short!("initialized"),), (deal_value, milestone_count));
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

        let prev: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalFunded)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalFunded, &(prev + amount));

        // Track individual investor contributions for refunds
        let mut investors_map: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&DataKey::Investors)
            .unwrap_or(Map::new(&env));
        let existing = investors_map.get(caller.clone()).unwrap_or(0);
        investors_map.set(caller.clone(), existing + amount);
        env.storage().instance().set(&DataKey::Investors, &investors_map);

        usdc.transfer(&caller, &env.current_contract_address(), &amount);

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

        // Check if farmer or platform are frozen (compliance check)
        let frozen_map: Map<Address, bool> = env
            .storage()
            .instance()
            .get(&DataKey::FrozenContributors)
            .unwrap_or(Map::new(&env));
        
        if frozen_map.get(farmer.clone()).unwrap_or(false) {
            env.events()
                .publish((symbol_short!("compliance_halt"),), farmer.clone());
            return Err(Error::ContributorFrozen);
        }
        
        if frozen_map.get(platform.clone()).unwrap_or(false) {
            env.events()
                .publish((symbol_short!("compliance_halt"),), platform.clone());
            return Err(Error::ContributorFrozen);
        }

        let farmer_amount = (total_funded * 98) / 100;
        let platform_amount = total_funded - farmer_amount;

        // Lock settlement state before invoking external transfers so a
        // reentrant call sees `Released == true` and is rejected immediately.
        env.storage()
            .instance()
            .set(&DataKey::Released, &true);

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

        env.events()
            .publish((symbol_short!("release"),), total_funded);
        Ok(())
    }

    /// Records completion of a shipping milestone.
    /// Issue #345 — Automatic escrow settlement based on milestone verification.
    ///
    /// Only authorized accounts (admin or farmer) can record milestones.
    /// Prevents double-recording of the same milestone.
    ///
    /// # Arguments
    /// * `caller` - The account recording the milestone (must be admin or farmer)
    /// * `milestone_id` - The milestone ID being marked as complete (0-indexed)
    ///
    /// # Returns
    /// Error if:
    /// - Caller is not authorized (not admin or farmer)
    /// - Milestone ID is invalid or already recorded
    pub fn record_milestone(
        env: Env,
        caller: Address,
        milestone_id: u32,
    ) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }

        // Authorization check: only admin or farmer can record milestones
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

        // Validate milestone ID
        let milestone_count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MilestonesCount)
            .unwrap_or(0);

        if milestone_id >= milestone_count {
            return Err(Error::InvalidMilestones);
        }

        // Check if milestone already recorded
        let mut milestone_map: Map<u32, Milestone> = env
            .storage()
            .instance()
            .get(&DataKey::MilestoneData)
            .unwrap_or(Map::new(&env));

        if milestone_map.contains_key(milestone_id) {
            return Err(Error::MilestoneAlreadyRecorded);
        }

        // Create and store milestone
        let milestone = Milestone {
            id: milestone_id,
            completed: true,
            timestamp: env.ledger().timestamp(),
        };

        milestone_map.set(milestone_id, milestone);
        env.storage()
            .instance()
            .set(&DataKey::MilestoneData, &milestone_map);

        // Increment completed milestones counter
        let completed: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MilestonesCompleted)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::MilestonesCompleted, &(completed + 1));

        // Publish milestone recorded event
        env.events()
            .publish((symbol_short!("milestone"),), milestone_id);

        Ok(())
    }

    /// Settles the escrow by distributing funds to farmer and platform.
    /// Issue #345 — Automatic escrow settlement based on milestone verification.
    ///
    /// Can only be called when:
    /// - All milestones have been completed and recorded
    /// - Funds have been deposited (TotalFunded >= DealValue)
    /// - Funds have not already been released
    ///
    /// Distributes:
    /// - 98% to farmer
    /// - 2% to platform
    pub fn settle_escrow(env: Env, caller: Address) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }

        caller.require_auth();
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap();

        // Only admin can settle
        if caller != admin {
            return Err(Error::Unauthorized);
        }

        // Check if already released
        if env.storage().instance().get(&DataKey::Released).unwrap_or(false) {
            return Err(Error::AlreadyReleased);
        }

        // Verify all milestones are completed
        let milestone_count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MilestonesCount)
            .unwrap_or(0);
        let completed: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MilestonesCompleted)
            .unwrap_or(0);

        if completed < milestone_count {
            return Err(Error::InsufficientMilestonesCompleted);
        }

        // Verify sufficient funds
        let total_funded: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalFunded)
            .unwrap_or(0);
        let deal_value: i128 = env
            .storage()
            .instance()
            .get(&DataKey::DealValue)
            .unwrap_or(0);

        if total_funded < deal_value {
            return Err(Error::BalanceInsufficient);
        }

        // Get addresses and token
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

        // Check if farmer or platform are frozen (compliance check)
        let frozen_map: Map<Address, bool> = env
            .storage()
            .instance()
            .get(&DataKey::FrozenContributors)
            .unwrap_or(Map::new(&env));
        
        if frozen_map.get(farmer.clone()).unwrap_or(false) {
            env.events()
                .publish((symbol_short!("compliance_halt"),), farmer.clone());
            return Err(Error::ContributorFrozen);
        }
        
        if frozen_map.get(platform.clone()).unwrap_or(false) {
            env.events()
                .publish((symbol_short!("compliance_halt"),), platform.clone());
            return Err(Error::ContributorFrozen);
        }

        // Calculate distribution: 98% farmer, 2% platform
        let farmer_amount = (total_funded * 98) / 100;
        let platform_amount = total_funded - farmer_amount;

        // Mark as released before invoking external transfers so a reentrant
        // call sees `Released == true` and is rejected immediately.
        env.storage()
            .instance()
            .set(&DataKey::Released, &true);

        // Execute transfers
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

        env.events()
            .publish((symbol_short!("settled"),), total_funded);
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

    /// Returns the deal value in USDC stroops
    pub fn get_deal_value(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::DealValue)
            .unwrap_or(0)
    }

    /// Returns the total number of milestones for this deal
    pub fn get_milestones_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::MilestonesCount)
            .unwrap_or(0)
    }

    /// Returns the number of completed milestones
    pub fn get_milestones_completed(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::MilestonesCompleted)
            .unwrap_or(0)
    }

    /// Returns the list of investor addresses
    pub fn get_investors(env: Env) -> Vec<Address> {
        let investors_map: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&DataKey::Investors)
            .unwrap_or(Map::new(&env));
        investors_map.keys()
    }

    /// Checks if a specific milestone has been completed and recorded
    pub fn is_milestone_completed(env: Env, milestone_id: u32) -> bool {
        let milestone_map: Map<u32, Milestone> = env
            .storage()
            .instance()
            .get(&DataKey::MilestoneData)
            .unwrap_or(Map::new(&env));

        if let Some(milestone) = milestone_map.get(milestone_id) {
            return milestone.completed;
        }
        false
    }

    /// Returns the progress of milestone completion as a percentage (0-100)
    pub fn get_completion_progress(env: Env) -> u32 {
        let milestone_count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MilestonesCount)
            .unwrap_or(1);
        let completed: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MilestonesCompleted)
            .unwrap_or(0);

        if milestone_count == 0 {
            return 0;
        }
        (completed * 100) / milestone_count
    }

    /// Freeze a contributor to prevent them from receiving refunds or settlements
    /// Only the admin can freeze contributors
    pub fn freeze_contributor(env: Env, caller: Address, contributor: Address) -> Result<(), Error> {
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

        let mut frozen_map: Map<Address, bool> = env
            .storage()
            .instance()
            .get(&DataKey::FrozenContributors)
            .unwrap_or(Map::new(&env));
        
        frozen_map.set(contributor, true);
        env.storage().instance().set(&DataKey::FrozenContributors, &frozen_map);

        env.events()
            .publish((symbol_short!("frozen"),), contributor);
        Ok(())
    }

    /// Unfreeze a contributor to allow them to receive refunds or settlements
    /// Only the admin can unfreeze contributors
    pub fn unfreeze_contributor(env: Env, caller: Address, contributor: Address) -> Result<(), Error> {
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

        let mut frozen_map: Map<Address, bool> = env
            .storage()
            .instance()
            .get(&DataKey::FrozenContributors)
            .unwrap_or(Map::new(&env));
        
        if !frozen_map.contains_key(&contributor) {
            return Err(Error::NotFrozen);
        }

        frozen_map.remove(contributor);
        env.storage().instance().set(&DataKey::FrozenContributors, &frozen_map);

        env.events()
            .publish((symbol_short!("unfrozen"),), contributor);
        Ok(())
    }

    /// Check if a contributor is frozen
    pub fn is_contributor_frozen(env: Env, contributor: Address) -> bool {
        let frozen_map: Map<Address, bool> = env
            .storage()
            .instance()
            .get(&DataKey::FrozenContributors)
            .unwrap_or(Map::new(&env));
        frozen_map.get(contributor).unwrap_or(false)
    }

    /// Returns the funding deadline as a Unix timestamp
    pub fn get_funding_deadline(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::FundingDeadline)
            .unwrap_or(0)
    }

    /// Returns whether the funding target has been met
    pub fn target_met(env: Env) -> bool {
        let total_funded: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalFunded)
            .unwrap_or(0);
        let deal_value: i128 = env
            .storage()
            .instance()
            .get(&DataKey::DealValue)
            .unwrap_or(0);
        total_funded >= deal_value
    }

    /// Refunds a contributor after the funding deadline has passed
    /// and the target has not been met. This function is idempotent.
    ///
    /// # Arguments
    /// * `contributor` - The address of the contributor requesting a refund
    ///
    /// # Returns
    /// Error if:
    /// - Deadline has not passed (DeadlineNotPassed error)
    /// - Target has been met (TargetMet error)
    /// - Contributor has no funds to refund (NothingToRefund error)
    pub fn refund_after_expiry(env: Env, contributor: Address) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }

        contributor.require_auth();

        let now = env.ledger().timestamp();
        let deadline: u64 = env
            .storage()
            .instance()
            .get(&DataKey::FundingDeadline)
            .unwrap_or(0);

        // Check if deadline has passed
        if now <= deadline {
            return Err(Error::DeadlineNotPassed);
        }

        // Check if target has been met
        if Self::target_met(env.clone()) {
            return Err(Error::TargetMet);
        }

        // Check if funds have already been released
        if env.storage().instance().get(&DataKey::Released).unwrap_or(false) {
            return Err(Error::AlreadyReleased);
        }

        // Get contributor's investment amount
        let investors_map: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&DataKey::Investors)
            .unwrap_or(Map::new(&env));
        let amount = investors_map.get(contributor.clone()).unwrap_or(0);

        if amount <= 0 {
            return Err(Error::NothingToRefund);
        }

        // Check if already refunded (idempotency)
        let refunded_map: Map<Address, bool> = env
            .storage()
            .instance()
            .get(&DataKey::Refunded)
            .unwrap_or(Map::new(&env));
        if refunded_map.get(contributor.clone()).unwrap_or(false) {
            // Already refunded, return success (idempotent)
            return Ok(());
        }

        // Check if contributor is frozen (compliance check)
        let frozen_map: Map<Address, bool> = env
            .storage()
            .instance()
            .get(&DataKey::FrozenContributors)
            .unwrap_or(Map::new(&env));
        if frozen_map.get(contributor.clone()).unwrap_or(false) {
            // Emit compliance halt event
            env.events()
                .publish((symbol_short!("compliance_halt"),), contributor.clone());
            return Err(Error::ContributorFrozen);
        }

        // Mark as refunded before transfer to prevent reentrancy
        let mut updated_refunded_map = refunded_map;
        updated_refunded_map.set(contributor.clone(), true);
        env.storage().instance().set(&DataKey::Refunded, &updated_refunded_map);

        // Update investor's contribution to 0
        let mut updated_investors_map = investors_map;
        updated_investors_map.set(contributor.clone(), 0i128);
        env.storage().instance().set(&DataKey::Investors, &updated_investors_map);

        // Update total funded
        let total_funded: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalFunded)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalFunded, &(total_funded - amount));

        // Transfer refund
        let usdc_token: Address = env
            .storage()
            .instance()
            .get(&DataKey::UsdcToken)
            .unwrap();
        let usdc = token::Client::new(&env, &usdc_token);
        usdc.transfer(&env.current_contract_address(), &contributor, &amount);

        env.events()
            .publish((symbol_short!("refund"), contributor), amount);
        Ok(())
    }

    /// Batch refund all contributors after the funding deadline has passed
    /// and the target has not been met. Can only be called by admin.
    ///
    /// # Arguments
    /// * `caller` - The admin account calling this function
    ///
    /// # Returns
    /// Error if:
    /// - Caller is not admin (Unauthorized error)
    /// - Deadline has not passed (DeadlineNotPassed error)
    /// - Target has been met (TargetMet error)
    pub fn refund_all_after_expiry(env: Env, caller: Address) -> Result<(), Error> {
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

        let now = env.ledger().timestamp();
        let deadline: u64 = env
            .storage()
            .instance()
            .get(&DataKey::FundingDeadline)
            .unwrap_or(0);

        // Check if deadline has passed
        if now <= deadline {
            return Err(Error::DeadlineNotPassed);
        }

        // Check if target has been met
        if Self::target_met(env.clone()) {
            return Err(Error::TargetMet);
        }

        // Check if funds have already been released
        if env.storage().instance().get(&DataKey::Released).unwrap_or(false) {
            return Err(Error::AlreadyReleased);
        }

        // Get all investors
        let investors_map: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&DataKey::Investors)
            .unwrap_or(Map::new(&env));
        let refunded_map: Map<Address, bool> = env
            .storage()
            .instance()
            .get(&DataKey::Refunded)
            .unwrap_or(Map::new(&env));

        let usdc_token: Address = env
            .storage()
            .instance()
            .get(&DataKey::UsdcToken)
            .unwrap();
        let usdc = token::Client::new(&env, &usdc_token);

        let mut updated_refunded_map = refunded_map;
        let mut updated_investors_map = investors_map;
        let mut total_refunded: i128 = 0;
        let frozen_map: Map<Address, bool> = env
            .storage()
            .instance()
            .get(&DataKey::FrozenContributors)
            .unwrap_or(Map::new(&env));

        // Refund all investors who haven't been refunded yet and are not frozen
        for (investor, amount) in investors_map.iter() {
            if amount > 0 && !updated_refunded_map.get(investor.clone()).unwrap_or(false) {
                // Check if investor is frozen
                if frozen_map.get(investor.clone()).unwrap_or(false) {
                    // Emit compliance halt event and skip this investor
                    env.events()
                        .publish((symbol_short!("compliance_halt"),), investor.clone());
                    continue;
                }

                // Mark as refunded
                updated_refunded_map.set(investor.clone(), true);
                updated_investors_map.set(investor.clone(), 0i128);
                total_refunded += amount;

                // Transfer refund
                usdc.transfer(&env.current_contract_address(), &investor, &amount);
                env.events()
                    .publish((symbol_short!("refund"), investor), amount);
            }
        }

        // Update storage
        env.storage().instance().set(&DataKey::Refunded, &updated_refunded_map);
        env.storage().instance().set(&DataKey::Investors, &updated_investors_map);

        // Update total funded
        let total_funded: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalFunded)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalFunded, &(total_funded - total_refunded));

        env.events()
            .publish((symbol_short!("batch_refund"),), total_refunded);
        Ok(())
    }
}
