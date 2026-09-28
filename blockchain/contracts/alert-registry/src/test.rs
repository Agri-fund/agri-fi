#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

struct Setup {
    env: Env,
    contract_id: Address,
    admin: Address,
    watcher_registry: Address,
    watcher: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let watcher_registry = Address::generate(&env);
    let watcher = Address::generate(&env);

    let contract_id = env.register_contract(None, AlertRegistryContract);
    AlertRegistryContractClient::new(&env, &contract_id)
        .initialize(&admin, &watcher_registry);

    Setup { env, contract_id, admin, watcher_registry, watcher }
}

fn add_simple_alert(client: &AlertRegistryContractClient, setup: &Setup, id: &str) {
    client.add_alert(
        &setup.watcher,
        &String::from_str(&setup.env, id),
        &String::from_str(&setup.env, "XLM"),
        &100i128,
        &60u64,
        &AlertCondition::PriceAbove,
    );
}

// ── Discriminant / numeric-code tests ─────────────────────────────────────────
//
// These tests are the "bindings" tests referenced in issue #180.  They assert
// the *numeric* discriminant that Soroban surfaces to clients as
// Error(Contract, #N).  Any change to the enum ordering must be reflected here.

#[test]
fn test_error_discriminant_unauthorized() {
    assert_eq!(Error::Unauthorized as u32, 1);
}

#[test]
fn test_error_discriminant_not_initialized() {
    assert_eq!(Error::NotInitialized as u32, 2);
}

#[test]
fn test_error_discriminant_already_initialized() {
    assert_eq!(Error::AlreadyInitialized as u32, 3);
}

#[test]
fn test_error_discriminant_watcher_not_found() {
    assert_eq!(Error::WatcherNotFound as u32, 4);
}

#[test]
fn test_error_discriminant_alert_not_found() {
    assert_eq!(Error::AlertNotFound as u32, 5);
}

#[test]
fn test_error_discriminant_invalid_threshold() {
    assert_eq!(Error::InvalidThreshold as u32, 6);
}

#[test]
fn test_error_discriminant_invalid_cooldown() {
    assert_eq!(Error::InvalidCooldown as u32, 7);
}

#[test]
fn test_error_discriminant_too_many_alerts() {
    assert_eq!(Error::TooManyAlerts as u32, 8);
}

#[test]
fn test_error_discriminant_alert_already_exists() {
    assert_eq!(Error::AlertAlreadyExists as u32, 9);
}

#[test]
fn test_error_discriminant_invalid_alert_id() {
    assert_eq!(Error::InvalidAlertId as u32, 10);
}

#[test]
fn test_error_discriminant_registry_call_failed() {
    assert_eq!(Error::RegistryCallFailed as u32, 11);
}

#[test]
fn test_error_discriminant_invalid_asset() {
    assert_eq!(Error::InvalidAsset as u32, 12);
}

/// GlobalAlertLimitExceeded is the canonical owner of code 13.
#[test]
fn test_error_discriminant_global_alert_limit_exceeded_is_13() {
    assert_eq!(Error::GlobalAlertLimitExceeded as u32, 13);
}

/// DuplicateRule must be 14, not 13.
#[test]
fn test_error_discriminant_duplicate_rule_is_14() {
    assert_eq!(Error::DuplicateRule as u32, 14);
}

/// RuleLimitPerAsset must be 15, not 13.
#[test]
fn test_error_discriminant_rule_limit_per_asset_is_15() {
    assert_eq!(Error::RuleLimitPerAsset as u32, 15);
}

/// InvalidWatcherRegistry must be 16, not 13 (issue #180 fix).
#[test]
fn test_error_discriminant_invalid_watcher_registry_is_16_not_13() {
    let code = Error::InvalidWatcherRegistry as u32;
    assert_eq!(code, 16, "InvalidWatcherRegistry must be 16, not 13");
    assert_ne!(code, 13, "InvalidWatcherRegistry must not share discriminant 13 with GlobalAlertLimitExceeded");
}

/// Paused must be 17, not 13 (issue #180 fix).
#[test]
fn test_error_discriminant_paused_is_17_not_13() {
    let code = Error::Paused as u32;
    assert_eq!(code, 17, "Paused must be 17, not 13");
    assert_ne!(code, 13, "Paused must not share discriminant 13 with GlobalAlertLimitExceeded");
}

/// All discriminants are unique — no two variants share the same u32 code.
#[test]
fn test_all_discriminants_are_unique() {
    let codes: &[u32] = &[
        Error::Unauthorized             as u32,  //  1
        Error::NotInitialized           as u32,  //  2
        Error::AlreadyInitialized       as u32,  //  3
        Error::WatcherNotFound          as u32,  //  4
        Error::AlertNotFound            as u32,  //  5
        Error::InvalidThreshold         as u32,  //  6
        Error::InvalidCooldown          as u32,  //  7
        Error::TooManyAlerts            as u32,  //  8
        Error::AlertAlreadyExists       as u32,  //  9
        Error::InvalidAlertId           as u32,  // 10
        Error::RegistryCallFailed       as u32,  // 11
        Error::InvalidAsset             as u32,  // 12
        Error::GlobalAlertLimitExceeded as u32,  // 13
        Error::DuplicateRule            as u32,  // 14
        Error::RuleLimitPerAsset        as u32,  // 15
        Error::InvalidWatcherRegistry   as u32,  // 16
        Error::Paused                   as u32,  // 17
    ];

    // Check every pair — O(n²) but the set is tiny.
    for i in 0..codes.len() {
        for j in (i + 1)..codes.len() {
            assert_ne!(
                codes[i], codes[j],
                "duplicate discriminant {} at positions {} and {}",
                codes[i], i, j
            );
        }
    }
}

// ── Initialisation tests ──────────────────────────────────────────────────────

#[test]
fn test_initialize() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);
    assert_eq!(client.get_global_alert_count(), 0);
    assert!(!client.is_paused());
}

#[test]
fn test_initialize_twice_fails() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);
    let result = client.try_initialize(&setup.admin, &setup.watcher_registry);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_get_watcher_registry() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);
    assert_eq!(
        client.get_watcher_registry().unwrap(),
        setup.watcher_registry
    );
}

// ── add_alert tests ───────────────────────────────────────────────────────────

#[test]
fn test_add_alert_success() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);

    add_simple_alert(&client, &setup, "alert_001");

    assert_eq!(client.get_global_alert_count(), 1);
    let rule = client.get_alert(&String::from_str(&setup.env, "alert_001")).unwrap();
    assert_eq!(rule.watcher, setup.watcher);
    assert_eq!(rule.threshold, 100);
}

#[test]
fn test_add_alert_empty_id_fails() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);

    let result = client.try_add_alert(
        &setup.watcher,
        &String::from_str(&setup.env, ""),
        &String::from_str(&setup.env, "XLM"),
        &100i128,
        &60u64,
        &AlertCondition::PriceAbove,
    );
    assert_eq!(result, Err(Ok(Error::InvalidAlertId)));
}

#[test]
fn test_add_alert_empty_asset_fails() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);

    let result = client.try_add_alert(
        &setup.watcher,
        &String::from_str(&setup.env, "alert_001"),
        &String::from_str(&setup.env, ""),
        &100i128,
        &60u64,
        &AlertCondition::PriceAbove,
    );
    assert_eq!(result, Err(Ok(Error::InvalidAsset)));
}

#[test]
fn test_add_alert_zero_threshold_fails() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);

    let result = client.try_add_alert(
        &setup.watcher,
        &String::from_str(&setup.env, "alert_001"),
        &String::from_str(&setup.env, "XLM"),
        &0i128,
        &60u64,
        &AlertCondition::PriceAbove,
    );
    assert_eq!(result, Err(Ok(Error::InvalidThreshold)));
}

#[test]
fn test_add_alert_negative_threshold_fails() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);

    let result = client.try_add_alert(
        &setup.watcher,
        &String::from_str(&setup.env, "alert_001"),
        &String::from_str(&setup.env, "XLM"),
        &-1i128,
        &60u64,
        &AlertCondition::PriceAbove,
    );
    assert_eq!(result, Err(Ok(Error::InvalidThreshold)));
}

#[test]
fn test_add_alert_zero_cooldown_fails() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);

    let result = client.try_add_alert(
        &setup.watcher,
        &String::from_str(&setup.env, "alert_001"),
        &String::from_str(&setup.env, "XLM"),
        &100i128,
        &0u64,
        &AlertCondition::PriceAbove,
    );
    assert_eq!(result, Err(Ok(Error::InvalidCooldown)));
}

#[test]
fn test_add_duplicate_alert_id_fails() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);

    add_simple_alert(&client, &setup, "alert_001");

    let result = client.try_add_alert(
        &setup.watcher,
        &String::from_str(&setup.env, "alert_001"),
        &String::from_str(&setup.env, "XLM"),
        &200i128,
        &120u64,
        &AlertCondition::PriceBelow,
    );
    assert_eq!(result, Err(Ok(Error::AlertAlreadyExists)));
}

#[test]
fn test_add_alert_multiple_conditions() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);

    for (id, condition) in [
        ("a1", AlertCondition::PriceAbove),
        ("a2", AlertCondition::PriceBelow),
        ("a3", AlertCondition::VolatilitySpike),
    ] {
        client.add_alert(
            &setup.watcher,
            &String::from_str(&setup.env, id),
            &String::from_str(&setup.env, "USDC"),
            &50i128,
            &30u64,
            &condition,
        );
    }
    assert_eq!(client.get_global_alert_count(), 3);
}

// ── remove_alert tests ────────────────────────────────────────────────────────

#[test]
fn test_remove_alert_by_owner() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);

    add_simple_alert(&client, &setup, "alert_001");
    assert_eq!(client.get_global_alert_count(), 1);

    client.remove_alert(&setup.watcher, &String::from_str(&setup.env, "alert_001"));
    assert_eq!(client.get_global_alert_count(), 0);

    let result = client.get_alert(&String::from_str(&setup.env, "alert_001"));
    assert_eq!(result, Err(Ok(Error::AlertNotFound)));
}

#[test]
fn test_remove_alert_by_admin() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);

    add_simple_alert(&client, &setup, "alert_001");
    client.remove_alert(&setup.admin, &String::from_str(&setup.env, "alert_001"));
    assert_eq!(client.get_global_alert_count(), 0);
}

#[test]
fn test_remove_alert_unauthorized_fails() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);

    add_simple_alert(&client, &setup, "alert_001");
    let stranger = Address::generate(&setup.env);

    let result = client.try_remove_alert(
        &stranger,
        &String::from_str(&setup.env, "alert_001"),
    );
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_remove_nonexistent_alert_fails() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);

    let result = client.try_remove_alert(
        &setup.watcher,
        &String::from_str(&setup.env, "ghost"),
    );
    assert_eq!(result, Err(Ok(Error::AlertNotFound)));
}

// ── Pause tests ───────────────────────────────────────────────────────────────

/// When the contract is paused, add_alert must return Error::Paused (code 17),
/// NOT Error::GlobalAlertLimitExceeded (code 13) or any other error.
#[test]
fn test_add_alert_while_paused_returns_paused_code_17() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);

    client.pause(&setup.admin);
    assert!(client.is_paused());

    let result = client.try_add_alert(
        &setup.watcher,
        &String::from_str(&setup.env, "alert_001"),
        &String::from_str(&setup.env, "XLM"),
        &100i128,
        &60u64,
        &AlertCondition::PriceAbove,
    );
    assert_eq!(result, Err(Ok(Error::Paused)));
    // Explicitly confirm the variant code so clients can distinguish it from #13
    assert_eq!(Error::Paused as u32, 17);
}

/// When the contract is paused, remove_alert must return Error::Paused (code 17).
#[test]
fn test_remove_alert_while_paused_returns_paused_code_17() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);

    add_simple_alert(&client, &setup, "alert_001");
    client.pause(&setup.admin);

    let result = client.try_remove_alert(
        &setup.watcher,
        &String::from_str(&setup.env, "alert_001"),
    );
    assert_eq!(result, Err(Ok(Error::Paused)));
    assert_eq!(Error::Paused as u32, 17);
}

#[test]
fn test_unpause_re_enables_add_alert() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);

    client.pause(&setup.admin);
    client.unpause(&setup.admin);
    assert!(!client.is_paused());

    // Should succeed after unpause
    add_simple_alert(&client, &setup, "alert_001");
    assert_eq!(client.get_global_alert_count(), 1);
}

#[test]
fn test_pause_by_non_admin_fails() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);

    let result = client.try_pause(&setup.watcher);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

// ── Per-asset counter tests ───────────────────────────────────────────────────

#[test]
fn test_asset_alert_count_increments_and_decrements() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);
    let asset = String::from_str(&setup.env, "XLM");

    add_simple_alert(&client, &setup, "alert_001");
    assert_eq!(client.get_asset_alert_count(&asset), 1);

    client.remove_alert(&setup.watcher, &String::from_str(&setup.env, "alert_001"));
    assert_eq!(client.get_asset_alert_count(&asset), 0);
}

// ── get_alert / get_watcher_alerts view tests ─────────────────────────────────

#[test]
fn test_get_alert_not_found() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);

    let result = client.get_alert(&String::from_str(&setup.env, "none"));
    assert_eq!(result, Err(Ok(Error::AlertNotFound)));
}

#[test]
fn test_get_watcher_alerts_empty() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);

    let ids = client.get_watcher_alerts(&setup.watcher);
    assert_eq!(ids.len(), 0);
}

#[test]
fn test_get_watcher_alerts_lists_registered_ids() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);

    add_simple_alert(&client, &setup, "a1");
    add_simple_alert(&client, &setup, "a2");
    add_simple_alert(&client, &setup, "a3");

    let ids = client.get_watcher_alerts(&setup.watcher);
    assert_eq!(ids.len(), 3);
}

#[test]
fn test_get_watcher_alerts_decrements_after_remove() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);

    add_simple_alert(&client, &setup, "a1");
    add_simple_alert(&client, &setup, "a2");
    client.remove_alert(&setup.watcher, &String::from_str(&setup.env, "a1"));

    let ids = client.get_watcher_alerts(&setup.watcher);
    assert_eq!(ids.len(), 1);
    assert_eq!(ids.get(0).unwrap(), String::from_str(&setup.env, "a2"));
}

// ── Uninitialized contract tests ──────────────────────────────────────────────

#[test]
fn test_add_alert_without_init_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let watcher = Address::generate(&env);
    let contract_id = env.register_contract(None, AlertRegistryContract);
    let client = AlertRegistryContractClient::new(&env, &contract_id);

    let result = client.try_add_alert(
        &watcher,
        &String::from_str(&env, "a1"),
        &String::from_str(&env, "XLM"),
        &100i128,
        &60u64,
        &AlertCondition::PriceAbove,
    );
    assert_eq!(result, Err(Ok(Error::NotInitialized)));
}

#[test]
fn test_get_watcher_registry_without_init_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AlertRegistryContract);
    let client = AlertRegistryContractClient::new(&env, &contract_id);

    let result = client.try_get_watcher_registry();
    // Returns InvalidWatcherRegistry (16) when the key is absent
    assert_eq!(result, Err(Ok(Error::InvalidWatcherRegistry)));
    assert_eq!(Error::InvalidWatcherRegistry as u32, 16);
}

// ── Ledger timestamp recorded in rule ────────────────────────────────────────

#[test]
fn test_alert_created_at_matches_ledger_timestamp() {
    let setup = setup();
    let client = AlertRegistryContractClient::new(&setup.env, &setup.contract_id);

    let ts_before = setup.env.ledger().timestamp();
    add_simple_alert(&client, &setup, "ts_alert");
    let ts_after = setup.env.ledger().timestamp();

    let rule = client.get_alert(&String::from_str(&setup.env, "ts_alert")).unwrap();
    assert!(rule.created_at >= ts_before && rule.created_at <= ts_after);
}
