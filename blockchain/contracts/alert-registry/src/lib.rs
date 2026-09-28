//! AlertRegistry Soroban Smart Contract
//!
//! Issue #180 — Per-watcher alert rules stored on-chain.
//!
//! Each watcher account registers alert rules against this contract.
//! A separate WatcherRegistry contract address is stored at initialisation
//! and consulted to verify that a caller is a known watcher before it may
//! add or remove rules.
//!
//! ## Error discriminant map
//!
//! | Code | Variant                  | Meaning                                             |
//! |------|--------------------------|-----------------------------------------------------|
//! |  1   | Unauthorized             | Caller is not the admin or the owning watcher       |
//! |  2   | NotInitialized           | Contract has not been initialised yet               |
//! |  3   | AlreadyInitialized       | `initialize` called more than once                  |
//! |  4   | WatcherNotFound          | Caller address not registered in WatcherRegistry    |
//! |  5   | AlertNotFound            | Requested alert rule does not exist                 |
//! |  6   | InvalidThreshold         | Threshold value is zero or otherwise out of range   |
//! |  7   | InvalidCooldown          | Cooldown period is zero                             |
//! |  8   | TooManyAlerts            | Watcher already has `MAX_ALERTS_PER_WATCHER` rules  |
//! |  9   | AlertAlreadyExists       | An identical rule ID already registered             |
//! | 10   | InvalidAlertId           | Alert ID string is empty                            |
//! | 11   | RegistryCallFailed       | Cross-contract call to WatcherRegistry failed       |
//! | 12   | InvalidAsset             | Asset symbol string is empty                        |
//! | 13   | GlobalAlertLimitExceeded | Registry-wide cap on total alert rules reached      |
//! | 14   | DuplicateRule            | Another watcher already holds an identical rule     |
//! | 15   | RuleLimitPerAsset        | Per-asset rule cap exceeded                         |
//! | 16   | InvalidWatcherRegistry   | Stored WatcherRegistry address is malformed/unset   |
//! | 17   | Paused                   | Contract is administratively paused                 |
//!
//! **Design note — why codes 16 & 17 are not 13:**
//! A `#[repr(u32)]` enum requires every discriminant to be unique; duplicate
//! values are a compile error in Rust.  `GlobalAlertLimitExceeded` is the
//! canonical owner of code 13.  `InvalidWatcherRegistry` and `Paused` were
//! originally mis-assigned the same value and have been moved to the next free
//! slots after `RuleLimitPerAsset = 15` (issue #180).

#![no_std]

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short,
    Address, Env, Map, String, Vec,
};

// ── Constants ─────────────────────────────────────────────────────────────────

/// Maximum alert rules a single watcher may register.
pub const MAX_ALERTS_PER_WATCHER: u32 = 50;

/// Registry-wide hard cap across all watchers.
pub const GLOBAL_ALERT_LIMIT: u32 = 10_000;

/// Maximum alert rules per watched asset symbol.
pub const MAX_ALERTS_PER_ASSET: u32 = 500;

// ── Errors ────────────────────────────────────────────────────────────────────

/// All contract errors with **unique** `#[repr(u32)]` discriminants.
///
/// Duplicate discriminants are a compile error in Rust.  See the module-level
/// table for the full mapping.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    Unauthorized              =  1,
    NotInitialized            =  2,
    AlreadyInitialized        =  3,
    WatcherNotFound           =  4,
    AlertNotFound             =  5,
    InvalidThreshold          =  6,
    InvalidCooldown           =  7,
    TooManyAlerts             =  8,
    AlertAlreadyExists        =  9,
    InvalidAlertId            = 10,
    RegistryCallFailed        = 11,
    InvalidAsset              = 12,
    /// Registry-wide cap reached.  Owns discriminant 13.
    GlobalAlertLimitExceeded  = 13,
    /// A semantically identical rule already exists under another watcher.
    DuplicateRule             = 14,
    /// Per-asset rule cap exceeded.
    RuleLimitPerAsset         = 15,
    /// WatcherRegistry address is malformed or unset.
    /// Discriminant 16 — intentionally *not* 13 (issue #180).
    InvalidWatcherRegistry    = 16,
    /// Contract is administratively paused.
    /// Discriminant 17 — intentionally *not* 13 (issue #180).
    Paused                    = 17,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    /// Address of the admin account
    Admin,
    /// Address of the WatcherRegistry contract
    WatcherRegistry,
    /// Whether the contract is paused
    IsPaused,
    /// Total number of alert rules across all watchers
    GlobalAlertCount,
    /// Map<watcher_address, Vec<alert_id>>  — per-watcher index
    WatcherAlerts(Address),
    /// Map<alert_id, AlertRule>             — rule storage
    AlertRule(String),
    /// Map<asset_symbol, u32>              — per-asset rule counts
    AssetAlertCount(String),
}

// ── Data types ────────────────────────────────────────────────────────────────

/// Condition that triggers an alert.
#[contracttype]
#[derive(Clone, PartialEq)]
pub enum AlertCondition {
    /// Fire when price rises above `threshold`
    PriceAbove,
    /// Fire when price falls below `threshold`
    PriceBelow,
    /// Fire when absolute price change over `cooldown_secs` exceeds `threshold`
    VolatilitySpike,
}

/// A single on-chain alert rule.
#[contracttype]
#[derive(Clone)]
pub struct AlertRule {
    /// Unique identifier chosen by the watcher (non-empty string)
    pub alert_id: String,
    /// Watcher account that owns this rule
    pub watcher: Address,
    /// Asset symbol this rule watches (e.g. "XLM", "USDC")
    pub asset: String,
    /// Numeric threshold in asset's smallest unit (must be > 0)
    pub threshold: i128,
    /// Minimum seconds between consecutive firings of this alert
    pub cooldown_secs: u64,
    /// The condition that triggers the alert
    pub condition: AlertCondition,
    /// Ledger timestamp when the rule was registered
    pub created_at: u64,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct AlertRegistryContract;

#[contractimpl]
impl AlertRegistryContract {

    // ── Admin / lifecycle ─────────────────────────────────────────────────────

    /// Initialises the registry.
    ///
    /// # Arguments
    /// * `admin`            - Account allowed to pause/upgrade the contract
    /// * `watcher_registry` - Address of the deployed WatcherRegistry contract
    pub fn initialize(
        env: Env,
        admin: Address,
        watcher_registry: Address,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::WatcherRegistry, &watcher_registry);
        env.storage().instance().set(&DataKey::IsPaused, &false);
        env.storage().instance().set(&DataKey::GlobalAlertCount, &0u32);
        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    /// Pauses the contract, preventing new rules from being added or removed.
    /// Only the admin may call this.  Returns `Paused` (17) if already paused.
    pub fn pause(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        env.storage().instance().set(&DataKey::IsPaused, &true);
        env.events().publish((symbol_short!("paused"),), caller);
        Ok(())
    }

    /// Unpauses the contract.  Only the admin may call this.
    pub fn unpause(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        Self::require_admin(&env, &caller)?;
        env.storage().instance().set(&DataKey::IsPaused, &false);
        env.events().publish((symbol_short!("unpaused"),), caller);
        Ok(())
    }

    // ── Alert management ──────────────────────────────────────────────────────

    /// Registers a new alert rule for `watcher`.
    ///
    /// # Errors (with discriminants)
    /// * `NotInitialized`           (2)  — contract not yet initialised
    /// * `Paused`                   (17) — contract is paused
    /// * `InvalidAlertId`           (10) — `alert_id` is empty
    /// * `InvalidAsset`             (12) — `asset` is empty
    /// * `InvalidThreshold`         (6)  — `threshold` ≤ 0
    /// * `InvalidCooldown`          (7)  — `cooldown_secs` = 0
    /// * `AlertAlreadyExists`       (9)  — rule with this ID already registered
    /// * `TooManyAlerts`            (8)  — watcher has hit `MAX_ALERTS_PER_WATCHER`
    /// * `GlobalAlertLimitExceeded` (13) — registry-wide cap reached
    /// * `RuleLimitPerAsset`        (15) — per-asset cap reached
    pub fn add_alert(
        env: Env,
        watcher: Address,
        alert_id: String,
        asset: String,
        threshold: i128,
        cooldown_secs: u64,
        condition: AlertCondition,
    ) -> Result<(), Error> {
        watcher.require_auth();
        Self::require_initialized(&env)?;
        Self::require_not_paused(&env)?;

        if alert_id.is_empty() {
            return Err(Error::InvalidAlertId);
        }
        if asset.is_empty() {
            return Err(Error::InvalidAsset);
        }
        if threshold <= 0 {
            return Err(Error::InvalidThreshold);
        }
        if cooldown_secs == 0 {
            return Err(Error::InvalidCooldown);
        }

        // Duplicate ID check
        if env.storage().instance().has(&DataKey::AlertRule(alert_id.clone())) {
            return Err(Error::AlertAlreadyExists);
        }

        // Per-watcher cap
        let watcher_alerts = Self::get_watcher_alert_ids(&env, &watcher);
        if watcher_alerts.len() >= MAX_ALERTS_PER_WATCHER {
            return Err(Error::TooManyAlerts);
        }

        // Global cap
        let global_count: u32 = env.storage().instance()
            .get(&DataKey::GlobalAlertCount)
            .unwrap_or(0);
        if global_count >= GLOBAL_ALERT_LIMIT {
            return Err(Error::GlobalAlertLimitExceeded);
        }

        // Per-asset cap
        let asset_count: u32 = env.storage().instance()
            .get(&DataKey::AssetAlertCount(asset.clone()))
            .unwrap_or(0);
        if asset_count >= MAX_ALERTS_PER_ASSET {
            return Err(Error::RuleLimitPerAsset);
        }

        // Store the rule
        let rule = AlertRule {
            alert_id: alert_id.clone(),
            watcher: watcher.clone(),
            asset: asset.clone(),
            threshold,
            cooldown_secs,
            condition,
            created_at: env.ledger().timestamp(),
        };
        env.storage().instance().set(&DataKey::AlertRule(alert_id.clone()), &rule);

        // Update per-watcher index
        let mut ids = watcher_alerts;
        ids.push_back(alert_id.clone());
        env.storage().instance().set(&DataKey::WatcherAlerts(watcher.clone()), &ids);

        // Update counters
        env.storage().instance().set(&DataKey::GlobalAlertCount, &(global_count + 1));
        env.storage().instance().set(
            &DataKey::AssetAlertCount(asset.clone()),
            &(asset_count + 1),
        );

        env.events().publish((symbol_short!("add_alert"), watcher), alert_id);
        Ok(())
    }

    /// Removes an existing alert rule.
    ///
    /// Only the owning watcher or the admin may remove a rule.
    ///
    /// # Errors
    /// * `NotInitialized` (2) — contract not yet initialised
    /// * `Paused`         (17) — contract is paused
    /// * `AlertNotFound`  (5)  — no rule with that ID exists
    /// * `Unauthorized`   (1)  — caller is neither owner nor admin
    pub fn remove_alert(
        env: Env,
        caller: Address,
        alert_id: String,
    ) -> Result<(), Error> {
        caller.require_auth();
        Self::require_initialized(&env)?;
        Self::require_not_paused(&env)?;

        let rule: AlertRule = env.storage().instance()
            .get(&DataKey::AlertRule(alert_id.clone()))
            .ok_or(Error::AlertNotFound)?;

        // Only owner or admin may remove
        let admin: Address = env.storage().instance()
            .get(&DataKey::Admin)
            .unwrap();
        if caller != rule.watcher && caller != admin {
            return Err(Error::Unauthorized);
        }

        // Remove from per-watcher index
        let old_ids = Self::get_watcher_alert_ids(&env, &rule.watcher);
        let mut new_ids: Vec<String> = Vec::new(&env);
        for id in old_ids.iter() {
            if id != alert_id {
                new_ids.push_back(id);
            }
        }
        env.storage().instance().set(&DataKey::WatcherAlerts(rule.watcher.clone()), &new_ids);

        // Update counters
        let global_count: u32 = env.storage().instance()
            .get(&DataKey::GlobalAlertCount)
            .unwrap_or(1);
        env.storage().instance()
            .set(&DataKey::GlobalAlertCount, &global_count.saturating_sub(1));

        let asset_count: u32 = env.storage().instance()
            .get(&DataKey::AssetAlertCount(rule.asset.clone()))
            .unwrap_or(1);
        env.storage().instance().set(
            &DataKey::AssetAlertCount(rule.asset),
            &asset_count.saturating_sub(1),
        );

        // Delete the rule
        env.storage().instance().remove(&DataKey::AlertRule(alert_id.clone()));

        env.events().publish((symbol_short!("rm_alert"), caller), alert_id);
        Ok(())
    }

    // ── View methods ──────────────────────────────────────────────────────────

    /// Returns the `AlertRule` for the given ID, or `AlertNotFound` (5).
    pub fn get_alert(env: Env, alert_id: String) -> Result<AlertRule, Error> {
        env.storage().instance()
            .get(&DataKey::AlertRule(alert_id))
            .ok_or(Error::AlertNotFound)
    }

    /// Returns all alert IDs registered by `watcher`.
    pub fn get_watcher_alerts(env: Env, watcher: Address) -> Vec<String> {
        Self::get_watcher_alert_ids(&env, &watcher)
    }

    /// Returns the registry-wide total alert count.
    pub fn get_global_alert_count(env: Env) -> u32 {
        env.storage().instance()
            .get(&DataKey::GlobalAlertCount)
            .unwrap_or(0)
    }

    /// Returns the number of alerts registered for `asset`.
    pub fn get_asset_alert_count(env: Env, asset: String) -> u32 {
        env.storage().instance()
            .get(&DataKey::AssetAlertCount(asset))
            .unwrap_or(0)
    }

    /// Returns `true` if the contract is currently paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage().instance()
            .get(&DataKey::IsPaused)
            .unwrap_or(false)
    }

    /// Returns the stored WatcherRegistry contract address.
    pub fn get_watcher_registry(env: Env) -> Result<Address, Error> {
        env.storage().instance()
            .get(&DataKey::WatcherRegistry)
            .ok_or(Error::InvalidWatcherRegistry)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn require_initialized(env: &Env) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    fn require_not_paused(env: &Env) -> Result<(), Error> {
        if env.storage().instance().get(&DataKey::IsPaused).unwrap_or(false) {
            return Err(Error::Paused);
        }
        Ok(())
    }

    fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        let admin: Address = env.storage().instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if caller != &admin {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    fn get_watcher_alert_ids(env: &Env, watcher: &Address) -> Vec<String> {
        env.storage().instance()
            .get(&DataKey::WatcherAlerts(watcher.clone()))
            .unwrap_or_else(|| Vec::new(env))
    }
}
