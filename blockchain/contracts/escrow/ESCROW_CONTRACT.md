# Soroban Escrow Smart Contract

## Overview

The Escrow Smart Contract is a Soroban WASM contract that manages the automatic settlement of deals based on shipping milestones. It removes platform escrow custody risk by enforcing milestone verification and automatic fund distribution through smart contract execution.

## Issue

**Issue #345**: Design Soroban smart contract for automatic escrow settlement

The contract enables automatic, trustless payout execution when milestones are verified, eliminating the need for platform-managed escrow accounts.

## Contract State

The contract maintains the following state data:

### Core Deal Information
- **Admin**: Account authorized to approve milestones and settle funds
- **Farmer**: Recipient of 98% of escrow funds
- **Platform**: Recipient of 2% fee from escrow funds
- **USDC Token**: ERC-20 compatible token contract address
- **Deal Value**: Total deal amount in USDC stroops

### Investor Information
- **Investors**: List of investor wallet addresses funding the deal
- **Total Funded**: Cumulative USDC received from investors

### Milestone Tracking
- **Milestones Count**: Total number of milestones required for completion
- **Milestones Completed**: Number of successfully recorded milestones
- **Milestone Data**: Map storing completion status and timestamp for each milestone

### Release State
- **Released**: Flag indicating if funds have been distributed
- **Delivery Approved**: Legacy flag for delivery approval (deprecated in favor of milestone system)

## Data Structures

### Milestone Struct
```rust
pub struct Milestone {
    pub id: u32,              // Unique milestone identifier (0-indexed)
    pub completed: bool,      // Completion status
    pub timestamp: u64,       // Block timestamp when recorded
}
```

### DataKey Enum
Defines all storage keys for contract state:
```rust
pub enum DataKey {
    Admin,                    // Primary admin account
    Farmer,                   // Farmer/beneficiary address
    Platform,                 // Platform fee account
    UsdcToken,               // USDC token contract
    DealValue,               // Total deal value in stroops
    TotalFunded,             // Cumulative funding received
    Released,                // Settlement completed flag
    DeliveryApproved,        // Legacy delivery flag
    MilestonesCount,         // Total milestones required
    MilestonesCompleted,     // Milestones recorded
    Investors,               // List of investor addresses
    MilestoneData,           // Map of milestone records
}
```

## Public Methods

### Initialization

```rust
pub fn initialize(
    env: Env,
    admin: Address,
    farmer: Address,
    platform: Address,
    usdc_token: Address,
    deal_value: i128,
    milestone_count: u32,
    investors: Vec<Address>,
) -> Result<(), Error>
```

Initializes the contract with deal parameters.

**Parameters:**
- `admin` - Admin account for approving milestones and settling funds
- `farmer` - Farmer account receiving 98% of funds
- `platform` - Platform account receiving 2% fee
- `usdc_token` - USDC token contract address
- `deal_value` - Total deal value in USDC stroops
- `milestone_count` - Total number of milestones (must be > 0)
- `investors` - List of investor addresses (must be non-empty)

**Validation:**
- Cannot initialize twice (AlreadyInitialized error)
- Deal value must be positive (InvalidAmount error)
- Milestone count must be > 0 (InvalidMilestones error)
- Investor list must be non-empty (NoInvestors error)

**Events:**
- `initialized`: Emits (deal_value, milestone_count)

---

### Milestone Recording

```rust
pub fn record_milestone(
    env: Env,
    caller: Address,
    milestone_id: u32,
) -> Result<(), Error>
```

Records completion of a shipping milestone. Only authorized accounts (admin or farmer) can record milestones.

**Parameters:**
- `caller` - Account recording the milestone (must be admin or farmer)
- `milestone_id` - Milestone ID (0-indexed, must be < milestone_count)

**Authorization:**
- Only admin or farmer can record milestones (Unauthorized error)
- Caller must provide valid signature (require_auth check)

**Validation:**
- Milestone ID must be valid (InvalidMilestones error)
- Milestone cannot already be recorded (MilestoneAlreadyRecorded error)

**Behavior:**
- Records milestone with current block timestamp
- Increments milestones_completed counter
- Does NOT automatically settle funds (must call settle_escrow separately)

**Events:**
- `milestone`: Emits milestone_id

---

### Escrow Settlement

```rust
pub fn settle_escrow(
    env: Env,
    caller: Address,
) -> Result<(), Error>
```

Settles the escrow by distributing funds to farmer and platform. Can only be called when all milestones are completed and funds are available.

**Authorization:**
- Only admin can settle (Unauthorized error)
- Caller must provide valid signature (require_auth check)

**Prerequisites:**
- All milestones must be recorded (InsufficientMilestonesCompleted error)
- Total funded must be >= deal value (BalanceInsufficient error)
- Funds must not already be released (AlreadyReleased error)

**Fund Distribution:**
- Farmer: 98% of total funded amount
- Platform: 2% of total funded amount
- Uses USDC token contract transfer calls

**Events:**
- `settled`: Emits total_funded amount

---

### Fund Deposition

```rust
pub fn fund(
    env: Env,
    caller: Address,
    amount: i128,
) -> Result<(), Error>
```

Allows investors to deposit USDC into the escrow contract.

**Parameters:**
- `caller` - Investor account funding the escrow
- `amount` - USDC amount to deposit in stroops

**Validation:**
- Amount must be positive (InvalidAmount error)
- Contract must be initialized (NotInitialized error)

**Behavior:**
- Transfers USDC from caller to contract
- Increments total_funded balance
- Does NOT check if deal is fully funded (can fund beyond deal_value)

**Events:**
- `funded`: Emits amount deposited

---

### Legacy Methods (Backward Compatibility)

```rust
pub fn approve_delivery(env: Env, caller: Address) -> Result<(), Error>
```

Legacy method for approval workflow. Deprecated in favor of milestone system.

```rust
pub fn submit_delivery_milestone(env: Env, caller: Address) -> Result<(), Error>
```

Legacy milestone submission. Deprecated in favor of record_milestone.

```rust
pub fn release(env: Env, caller: Address) -> Result<(), Error>
```

Legacy fund release. Deprecated in favor of settle_escrow.

---

### Query Methods

```rust
pub fn get_total_funded(env: Env) -> i128
```
Returns total USDC deposited into the escrow.

```rust
pub fn get_deal_value(env: Env) -> i128
```
Returns the total deal value in USDC stroops.

```rust
pub fn get_milestones_count(env: Env) -> u32
```
Returns total number of milestones for this deal.

```rust
pub fn get_milestones_completed(env: Env) -> u32
```
Returns number of completed and recorded milestones.

```rust
pub fn get_investors(env: Env) -> Vec<Address>
```
Returns list of all investor addresses.

```rust
pub fn is_milestone_completed(env: Env, milestone_id: u32) -> bool
```
Checks if a specific milestone has been recorded.

```rust
pub fn get_completion_progress(env: Env) -> u32
```
Returns completion percentage (0-100) based on milestones recorded.

```rust
pub fn is_released(env: Env) -> bool
```
Returns whether funds have been distributed.

```rust
pub fn is_delivery_approved(env: Env) -> bool
```
Returns legacy delivery approval status.

---

## Error Codes

| Error | Code | Description |
|-------|------|-------------|
| Unauthorized | 1 | Caller not authorized for this operation |
| NotInitialized | 2 | Contract not initialized |
| AlreadyInitialized | 3 | Contract already initialized |
| InvalidAmount | 4 | Invalid amount (must be > 0) |
| InvalidShares | 5 | Invalid share configuration |
| AlreadyReleased | 6 | Funds already released/settled |
| BalanceInsufficient | 7 | Insufficient balance for operation |
| DeliveryNotApproved | 8 | Legacy: delivery not approved |
| InvalidMilestones | 9 | Invalid milestone ID or count |
| MilestoneAlreadyRecorded | 10 | Milestone already recorded |
| InsufficientMilestonesCompleted | 11 | Not all milestones completed |
| NoInvestors | 12 | No investors provided |

## Usage Flow

### 1. Initialize Contract

```rust
EscrowContract::initialize(
    env,
    admin_address,
    farmer_address,
    platform_address,
    usdc_token_address,
    10_000_000_000,  // 1000 USDC (7 decimal places)
    3,               // 3 milestones required
    vec![investor1, investor2, investor3],
)
```

### 2. Investors Fund the Deal

```rust
// Each investor deposits funds
EscrowContract::fund(env, investor1, 3_000_000_000);  // 300 USDC
EscrowContract::fund(env, investor2, 3_000_000_000);  // 300 USDC
EscrowContract::fund(env, investor3, 4_000_000_000);  // 400 USDC
// Total: 1000 USDC
```

### 3. Record Milestones as They Complete

```rust
// Shipping milestone 0 completed
EscrowContract::record_milestone(env, admin, 0);

// Shipping milestone 1 completed
EscrowContract::record_milestone(env, farmer, 1);

// Shipping milestone 2 completed
EscrowContract::record_milestone(env, admin, 2);
```

### 4. Settle the Escrow

```rust
// Once all milestones recorded and funds available
EscrowContract::settle_escrow(env, admin);
// Transfers 980 USDC to farmer, 20 USDC to platform
```

## Security Considerations

### Authorization
- Only admin can settle escrow funds
- Only admin or farmer can record milestones
- All operations require valid digital signatures
- Unauthorized accounts receive explicit error messages

### Milestone Integrity
- Milestones can only be recorded once (prevents double-counting)
- Milestone IDs are validated against milestone_count
- Completion state is immutable once recorded

### Fund Safety
- Funds transferred using standard USDC token contract
- Distribution percentages (98/2) are hardcoded and cannot be changed
- Double-settlement is prevented (AlreadyReleased error)

### Validation
- Deal value must be positive
- Milestone count must be positive
- Investor list must be non-empty
- Funding amounts must be positive

## Testing

### Test Coverage
- Contract initialization with various parameters
- Milestone recording by authorized accounts
- Milestone validation and duplicate prevention
- Completion progress tracking
- Settlement authorization and requirements
- Fund distribution percentages
- Error conditions and validation

### Test Files
- `src/test.rs` - Comprehensive unit tests using Soroban SDK test utilities

### Running Tests
```bash
cd blockchain/contracts/escrow
cargo test
```

## Deployment

### Prerequisites
- Rust toolchain with wasm32-unknown-unknown target
- Soroban CLI
- Deployed USDC token on target network

### Build
```bash
cargo build --release --target wasm32-unknown-unknown
```

### Deploy to Testnet
```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/escrow.wasm \
  --network testnet \
  --source <admin-account>
```

### Initialize on Testnet
```bash
soroban contract invoke \
  --id <contract-id> \
  --network testnet \
  --source <admin-account> \
  -- initialize \
  --admin <admin-address> \
  --farmer <farmer-address> \
  --platform <platform-address> \
  --usdc_token <usdc-contract> \
  --deal_value 10000000000 \
  --milestone_count 3 \
  --investors '<investors-json>'
```

## Future Enhancements

1. **Flexible Payout Distribution**
   - Allow custom farmer/platform percentages
   - Support multiple beneficiaries
   - Tiered distribution based on milestones

2. **Advanced Milestone Features**
   - Milestone descriptions and metadata
   - Optional dollar values per milestone
   - Partial fund release per milestone

3. **Dispute Resolution**
   - Milestone dispute window
   - Arbitration mechanism
   - Escrow hold on disputed amounts

4. **Investor Management**
   - Dynamic investor addition/removal
   - Share tracking per investor
   - Individual investor refunds

5. **Gas Optimization**
   - Batch milestone recording
   - Optimized state storage
   - Ledger entry optimization

## References

- [Soroban Documentation](https://developers.stellar.org/learn/build/smart-contracts)
- [Stellar Asset Contract Standard](https://developers.stellar.org/learn/encyclopedia/stellar-asset-contract)
- [USDC on Stellar](https://stellar.org/learn/what-is-usdc)
- [Soroban SDK Rust Docs](https://docs.rs/soroban-sdk/)

## Support

For issues, questions, or contributions:
- Create an issue in the GitHub repository
- Reference Issue #345 for escrow contract discussions
- Include test cases for bug reports

## License

This smart contract is part of the Agri-Fi platform and is subject to the project's license terms.

---

**Status**: Implemented for Issue #345  
**Last Updated**: 2026-06-28  
**Maintainer**: Blockchain Team
