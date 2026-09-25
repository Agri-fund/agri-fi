# Soroban Event Schema Standardization & Migration Guide (v1)

## Overview (Issue #1082)

The Agri-Fi indexing engine (`SorobanEventIndexer`) consumes events emitted by 6 Soroban smart contracts on the Stellar network:
1. `escrow`
2. `farm_campaign`
3. `farm_campaign_settlement`
4. `marketplace_settlement`
5. `project_factory`
6. `revenue_distributor`

Previously, event payloads and topic symbols used ad-hoc naming (`milestone_completed`, `partial_release`, `invested`, `order`, etc.), making indexer routing fragile. Under schema version **v1**, event schemas are standardized using the canonical topic naming format:

```text
{contract}.{event}
```

The schema definition is cataloged in `blockchain/shared/events.json` and consumed programmatically by `backend/src/soroban/events/event-schema.registry.ts`.

---

## Standardized Event Catalog (v1)

### 1. Escrow Contract (`escrow`)
| Standard Topic | Description | Serialized Fields |
|---|---|---|
| `escrow.initialized` | Contract instance initialized | `dealValue: i128`, `milestoneCount: u32` |
| `escrow.funded` | Contributor deposits escrow funds | `contributor: Address`, `amount: i128` |
| `escrow.approved` | Participant approves release terms | `approver: Address`, `approved: bool` |
| `escrow.milestone_completed` | Milestone tranche unlocked | `milestoneId: u32`, `completed: bool` |
| `escrow.released` | Escrow funds transferred to farmer | `recipient: Address`, `amount: i128` |
| `escrow.settled` | Escrow settlement finalized | `totalFunded: i128` |
| `escrow.compliance_halt` | Sanctions or compliance stop | `flaggedAccount: Address` |
| `escrow.refunded` | Contributor refund issued | `contributor: Address`, `amount: i128` |
| `escrow.frozen` | Account contribution frozen | `account: Address` |
| `escrow.unfrozen` | Account freeze lifted | `account: Address` |
| `escrow.batch_refunded` | Batch refund on cancellation | `totalRefunded: i128` |

### 2. Farm Campaign Contract (`farm_campaign`)
| Standard Topic | Description | Serialized Fields |
|---|---|---|
| `farm_campaign.initialized` | Campaign initialized | `campaignId: String` |
| `farm_campaign.max_funding` | Cap configured | `maxFunding: i128` |
| `farm_campaign.invested` | Investor participation | `investor: Address`, `amount: i128` |
| `farm_campaign.status_changed` | State transition | `newStatus: Symbol` |
| `farm_campaign.milestone_completed` | Tranche verified | `milestoneIndex: u32`, `trancheAmount: i128` |
| `farm_campaign.partial_released` | Partial release | `dealId: String`, `amountBps: u32`, `amount: i128` |
| `farm_campaign.revenue_distributed`| Harvest revenue split | `revenueAmount: i128` |
| `farm_campaign.dispute_raised` | Arbitration initiated | `milestoneIndex: u32`, `caller: Address` |
| `farm_campaign.dispute_resolved` | Arbitration decision | `milestoneIndex: u32`, `approved: bool` |
| `farm_campaign.arbitrator_updated` | New arbitrator set | `newArbitrator: Address` |
| `farm_campaign.refunded` | Campaign refund claimed | `investor: Address`, `amount: i128` |

### 3. Farm Campaign Settlement (`farm_campaign_settlement`)
| Standard Topic | Description | Serialized Fields |
|---|---|---|
| `farm_campaign_settlement.settlement_initiated` | Calculations started | `campaignId: String`, `totalYield: i128` |
| `farm_campaign_settlement.settlement_completed` | Settlement done | `dealId: String`, `settlementAmount: i128` |

### 4. Marketplace Settlement (`marketplace_settlement`)
| Standard Topic | Description | Serialized Fields |
|---|---|---|
| `marketplace_settlement.order_created` | Purchase order placed | `orderId: u64`, `buyer: Address`, `amount: i128` |
| `marketplace_settlement.trade_settled` | Produce delivered/paid | `orderId: u64`, `total: i128` |
| `marketplace_settlement.order_refunded`| Order canceled/refunded | `orderId: u64`, `refundAmount: i128` |

### 5. Project Factory (`project_factory`)
| Standard Topic | Description | Serialized Fields |
|---|---|---|
| `project_factory.campaign_created` | WASM instance deployed | `dealId: String`, `contractAddress: Address` |
| `project_factory.project_registered`| Metadata saved | `dealId: String`, `farmer: Address` |
| `project_factory.template_updated` | Bytecode upgraded | `wasmHash: BytesN<32>` |

### 6. Revenue Distributor (`revenue_distributor`)
| Standard Topic | Description | Serialized Fields |
|---|---|---|
| `revenue_distributor.initialized` | Distributor instance ready | `admin: Address` |
| `revenue_distributor.holder_registered`| Token balance recorded | `holder: Address`, `balance: i128` |
| `revenue_distributor.revenue_distributed`| Dividend pool deposited | `dealId: String`, `amount: i128`, `distributionCount: u32` |
| `revenue_distributor.revenue_claimed` | Dividend claimed | `holder: Address`, `amount: i128` |

---

## Backwards Compatibility & Backfill Strategy

### Normalization Pipeline
When `SorobanEventIndexer` polls RPC events, `normalizeContractEvent()` maps raw event envelopes:
1. **Direct v1 Topic Match**: If the first topic matches `{contract}.{event}` in `EVENT_SCHEMAS_V1`, the event is dispatched immediately.
2. **Context-Assisted Match**: If the contract address matches a known contract in configuration, it prefixes the unnamespaced topic (`${contractName}.${topic}`).
3. **Legacy Fallback Table**: Unnamespaced legacy topics (e.g., `milestone_completed`, `partial_release`, `invested`, `order`, `settled`) are re-mapped through `LEGACY_EVENT_TOPIC_MAP`.

### Historical Ledger Backfill
To replay historical ledger blocks prior to v1 schema deployment:
```bash
# Set backfill ledger range in environment
BACKFILL_START_LEDGER=1000000 BACKFILL_END_LEDGER=1050000 npm run soroban:backfill
```
The backfill process applies the identical `normalizeContractEvent()` pipeline, ensuring old and new events write to PostgreSQL transaction logs and milestone tables with identical consistency.
