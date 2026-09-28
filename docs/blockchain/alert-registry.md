# AlertRegistry Contract

> **Source:** `blockchain/contracts/alert-registry/src/lib.rs`
> **Issue:** #180

## Overview

The AlertRegistry stores per-watcher price-alert rules on-chain. Each watcher
account registers `AlertRule` entries against this contract. A companion
WatcherRegistry contract address is set at initialisation and is used to
confirm that a caller is a known watcher before it may add or remove rules.

## Interface

```
initialize(admin, watcher_registry)
pause(caller)
unpause(caller)
add_alert(watcher, alert_id, asset, threshold, cooldown_secs, condition) -> Result<(), Error>
remove_alert(caller, alert_id)                                            -> Result<(), Error>
get_alert(alert_id)                                                       -> Result<AlertRule, Error>
get_watcher_alerts(watcher)                                               -> Vec<String>
get_global_alert_count()                                                  -> u32
get_asset_alert_count(asset)                                              -> u32
is_paused()                                                               -> bool
get_watcher_registry()                                                    -> Result<Address, Error>
```

## Constants

| Constant                  | Value  | Meaning                                        |
|---------------------------|--------|------------------------------------------------|
| `MAX_ALERTS_PER_WATCHER`  | 50     | Hard cap on rules per watcher account          |
| `GLOBAL_ALERT_LIMIT`      | 10 000 | Registry-wide cap across all watchers          |
| `MAX_ALERTS_PER_ASSET`    | 500    | Maximum rules watching the same asset symbol   |

## AlertRule fields

| Field           | Type             | Description                                                  |
|-----------------|------------------|--------------------------------------------------------------|
| `alert_id`      | `String`         | Unique identifier chosen by the watcher (non-empty)          |
| `watcher`       | `Address`        | Watcher account that owns the rule                           |
| `asset`         | `String`         | Asset symbol being watched (e.g. `"XLM"`, `"USDC"`)         |
| `threshold`     | `i128`           | Trigger value in the asset's smallest unit (must be > 0)     |
| `cooldown_secs` | `u64`            | Minimum seconds between consecutive firings (must be > 0)    |
| `condition`     | `AlertCondition` | `PriceAbove`, `PriceBelow`, or `VolatilitySpike`             |
| `created_at`    | `u64`            | Ledger timestamp at registration time                        |

## Error codes

The `Error` enum is `#[repr(u32)]`. Every variant carries a **unique**
discriminant; duplicate values are a compile error in Rust and would prevent
clients from distinguishing errors that surface as `Error(Contract, #N)`.

| Code | Variant                    | When raised                                                   |
|------|----------------------------|---------------------------------------------------------------|
|  1   | `Unauthorized`             | Caller is not the admin or the owning watcher                 |
|  2   | `NotInitialized`           | Contract has not been initialised yet                         |
|  3   | `AlreadyInitialized`       | `initialize` called more than once                            |
|  4   | `WatcherNotFound`          | Caller address not in WatcherRegistry                         |
|  5   | `AlertNotFound`            | Requested alert ID does not exist                             |
|  6   | `InvalidThreshold`         | `threshold` ≤ 0                                              |
|  7   | `InvalidCooldown`          | `cooldown_secs` = 0                                           |
|  8   | `TooManyAlerts`            | Watcher already has `MAX_ALERTS_PER_WATCHER` rules            |
|  9   | `AlertAlreadyExists`       | An identical rule ID is already registered                    |
| 10   | `InvalidAlertId`           | `alert_id` is an empty string                                 |
| 11   | `RegistryCallFailed`       | Cross-contract call to WatcherRegistry failed                 |
| 12   | `InvalidAsset`             | `asset` is an empty string                                    |
| 13   | `GlobalAlertLimitExceeded` | Registry-wide cap (`GLOBAL_ALERT_LIMIT`) reached              |
| 14   | `DuplicateRule`            | Another watcher already holds a semantically identical rule   |
| 15   | `RuleLimitPerAsset`        | Per-asset cap (`MAX_ALERTS_PER_ASSET`) exceeded               |
| 16   | `InvalidWatcherRegistry`   | Stored WatcherRegistry address is malformed or absent         |
| 17   | `Paused`                   | Contract is administratively paused                           |

### Why codes 16 & 17 are not 13

In the original design `GlobalAlertLimitExceeded`, `InvalidWatcherRegistry`,
and `Paused` were all assigned discriminant `= 13`. A `#[repr(u32)]` enum with
duplicate discriminants is a **compile error** in Rust. Even if it compiled,
clients could not distinguish a paused contract from a full registry — both
would surface as `Error(Contract, #13)`.

The fix (issue #180):

- `GlobalAlertLimitExceeded` keeps `= 13` (canonical owner)
- `InvalidWatcherRegistry` → `= 16` (next free slot after `RuleLimitPerAsset = 15`)
- `Paused` → `= 17`

## Upgrade / admin flow

Only the `admin` address set during `initialize` may call `pause`, `unpause`.
Upgrades to the WASM are performed through the standard Soroban
`env.deployer().update_current_contract_wasm(new_wasm_hash)` path and must
also be gated behind an admin check (not yet exposed as a public entry point —
add an `upgrade` function following the pattern in the escrow contract if
needed).
