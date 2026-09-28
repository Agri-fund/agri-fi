# On-Chain Events Reference

This document lists every `env.events().publish(...)` call emitted by the
Soroban smart contracts in `blockchain/contracts/`.  Clients (indexers,
off-chain monitors) subscribe to these topics via the Stellar Horizon
`/events` endpoint or the Soroban RPC `getEvents` method.

---

## AlertRegistry (`contracts/alert-registry`)

| Symbol (topic[0])  | topic[1]        | Data payload    | When emitted                              |
|--------------------|-----------------|-----------------|-------------------------------------------|
| `"init"`           | —               | `admin: Address`| Contract successfully initialised         |
| `"paused"`         | —               | `caller: Address` | Admin paused the contract               |
| `"unpaused"`       | —               | `caller: Address` | Admin unpaused the contract             |
| `"add_alert"`      | `watcher: Address` | `alert_id: String` | Alert rule registered successfully  |
| `"rm_alert"`       | `caller: Address`  | `alert_id: String` | Alert rule removed                  |

### Error codes emitted as `Error(Contract, #N)`

Clients that receive a contract error for `AlertRegistry` can decode the
numeric code as follows.  See `docs/blockchain/alert-registry.md` for the full
table; the codes most relevant to event consumers are:

| Code | Variant                    | Client interpretation                                      |
|------|----------------------------|------------------------------------------------------------|
| 13   | `GlobalAlertLimitExceeded` | Registry is full; no new rules can be added               |
| 16   | `InvalidWatcherRegistry`   | The WatcherRegistry address stored in the contract is bad  |
| 17   | `Paused`                   | Contract is paused; retry after admin calls `unpause`      |

> **Important (issue #180):** Codes 16 and 17 were previously both set to 13,
> making them indistinguishable from `GlobalAlertLimitExceeded`.  They are now
> assigned unique discriminants.  Any client or indexer that was pattern-matching
> on `Error(Contract, #13)` to detect a paused contract or a bad registry address
> **must** be updated to check `#16` and `#17` respectively.

---

## Escrow (`contracts/escrow`)

| Symbol (topic[0])    | topic[1]  | Data payload        | When emitted                              |
|----------------------|-----------|---------------------|-------------------------------------------|
| `"initialized"`      | —         | `(deal_value, milestone_count)` | Contract initialised            |
| `"funded"`           | —         | `amount: i128`      | Investor funded the escrow                |
| `"approve"`          | —         | `true`              | Admin approved delivery                   |
| `"milestone"`        | —         | `true`              | Delivery milestone submitted              |
| `"release"`          | —         | `total: i128`       | Funds released to farmer + platform       |
| `"settled"`          | —         | `total: i128`       | Escrow settled via `settle_escrow`        |
| `"milestone"`        | —         | `milestone_id: u32` | Milestone recorded via `record_milestone` |
| `"upgrade"`          | —         | `true`              | Contract WASM upgraded                    |
| `"frozen"`           | —         | `contributor: Address` | Contributor frozen                     |
| `"unfrozen"`         | —         | `contributor: Address` | Contributor unfrozen                   |
| `"compliance_halt"`  | —         | `address: Address`  | Release/settle blocked by frozen account  |

---

## FarmCampaign (`contracts/farm_campaign`)

| Symbol (topic[0])    | topic[1]              | Data payload              | When emitted                                |
|----------------------|-----------------------|---------------------------|---------------------------------------------|
| `"initialized"`      | —                     | `()`                      | Campaign initialised                        |
| `"status_changed"`   | `"funded"`            | `total_raised: i128`      | Campaign reached its funding target         |
| `"status_changed"`   | `"active"`            | `()`                      | Admin approved campaign to Active           |
| `"status_changed"`   | `"delivered"`         | `()`                      | All milestones released                     |
| `"status_changed"`   | `"failed"`            | `()`                      | Admin marked campaign as Failed             |
| `"status_changed"`   | `"paused"`            | `()`                      | Admin paused campaign                       |
| `"status_changed"`   | `"open"`              | `()`                      | Admin unpaused campaign                     |
| `"invested"`         | `investor: Address`   | `amount: i128`            | Investor contributed funds                  |
| `"milestone"`        | `milestone_index: u32`| `tranche: i128`           | Milestone funds released to farmer          |
| `"partial_release"`  | —                     | `(amount_bps, release_amount)` | Partial milestone release               |
| `"complete"`         | —                     | `revenue_amount: i128`    | Revenue distribution completed              |
| `"payout"`           | `investor: Address`   | `share: i128`             | Individual investor payout                  |
| `"refund"`           | `investor: Address`   | `amount: i128`            | Investor refund issued                      |
| `"early_closed"`     | —                     | `(reason, refundable)`    | Admin closed campaign early                 |
| `"max_funding"`      | —                     | `max_funding: i128`       | Admin updated max funding cap               |
| `"dispute_raised"`   | `milestone_index: u32`| `caller: Address`         | Dispute raised on a milestone               |
| `"dispute_resolved"` | `milestone_index: u32`| `(approve, arbitrator)`   | Arbitrator resolved a dispute               |

---

## MarketplaceSettlement (`contracts/marketplace_settlement`)

| Symbol (topic[0]) | topic[1]           | Data payload      | When emitted                        |
|-------------------|--------------------|-------------------|-------------------------------------|
| `"order"`         | `buyer: Address`   | `amount: i128`    | New order created and funds escrowed |
| `"settled"`       | `order_id: String` | `total: i128`     | Order confirmed and funds dispersed  |
| `"refund"`        | `order_id: String` | `amount: i128`    | Order refunded to buyer              |

---

## ProjectFactory (`contracts/project_factory`)

| Symbol (topic[0])            | topic[1]           | Data payload               | When emitted                            |
|------------------------------|--------------------|----------------------------|-----------------------------------------|
| `"campaign"`                 | `deal_id: String`  | `contract_address: Address`| Campaign registered                     |
| `"deployed"`                 | `farmer: Address`  | `campaign_address: Address`| Campaign contract deployed              |
| `"CampaignParamsValidated"`  | —                  | `(target, deadline, fee)`  | Params validated before deployment      |

---

## RevenueDistributor (`contracts/revenue_distributor`)

| Symbol (topic[0]) | topic[1]           | Data payload        | When emitted                              |
|-------------------|--------------------|---------------------|-------------------------------------------|
| `"init"`          | —                  | `admin: Address`    | Contract initialised                      |
| `"reg_holder"`    | `holder: Address`  | `balance: i128`     | Holder registered or balance updated      |
| `"rev_dist"`      | `holder: Address`  | `amount: i128`      | Revenue distributed to individual holder  |
| `"dist_done"`     | —                  | `total_amount: i128`| Full distribution round completed         |

---

## Subscribing via Soroban RPC

```jsonc
// getEvents request — watch all AlertRegistry add_alert events
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getEvents",
  "params": {
    "startLedger": 1000000,
    "filters": [
      {
        "type": "contract",
        "contractIds": ["<ALERT_REGISTRY_CONTRACT_ID>"],
        "topics": [["AAAADgAAAAphZGRfYWxlcnQ="]]  // symbol_short!("add_alert") base64
      }
    ]
  }
}
```

For error events, filter on `type: "diagnostic"` with the contract ID and
decode the `Error(Contract, #N)` value from the XDR `ScError` field.
