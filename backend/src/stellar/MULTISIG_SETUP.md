# Stellar Platform Fee Wallet Multi-Signature Setup

## Overview

This document describes the multi-signature (multi-sig) configuration for the Agri-fi platform fee wallet on the Stellar network. The multi-sig setup enhances security by requiring multiple signers to authorize transfers of platform fees.

## Issue

**Issue #352**: Configure multi-signature setup for platform fee wallet

The main platform wallet receives fee distributions (2% per deal). To prevent theft, transfers require multi-signature authorization.

## Architecture

### Multi-Sig Configuration

The platform fee wallet is configured as a 2-of-3 multi-signature account:

- **Total Signers**: 3
  - Master Key (Platform Key): weight 1
  - Signer 1: weight 1
  - Signer 2: weight 1

- **Transaction Threshold**: 2
  - Requires minimum 2 signatures to approve any transaction

- **Thresholds by Operation Type**:
  - Low (read-only operations): 1 signature
  - Medium (account modifications like setOptions): 2 signatures
  - High (fund transfers, account merges): 2 signatures

### Security Benefits

1. **Theft Prevention**: Single key compromise doesn't compromise funds
2. **Dual Authorization**: Any fund transfer requires approval from at least 2 signers
3. **Key Separation**: Signers can be stored separately and managed independently
4. **Audit Trail**: All signers are publicly visible on the Stellar network

## Environment Configuration

To enable multi-signature support, configure the following environment variables:

```bash
# Platform fee wallet secret key
STELLAR_PLATFORM_SECRET=S...

# Multi-signature signer keys (additional to platform key)
STELLAR_MULTISIG_SIGNER_1_SECRET=S...
STELLAR_MULTISIG_SIGNER_2_SECRET=S...
```

### Generating Signer Keys

Use the Stellar SDK to generate new keypairs for signers:

```bash
# JavaScript/TypeScript
const { Keypair } = require('@stellar/stellar-sdk');
const signer1 = Keypair.random();
const signer2 = Keypair.random();

console.log('Signer 1 Public Key:', signer1.publicKey());
console.log('Signer 1 Secret Key:', signer1.secret());
console.log('Signer 2 Public Key:', signer2.publicKey());
console.log('Signer 2 Secret Key:', signer2.secret());
```

## API Endpoints

### Setup Multi-Signature

**POST** `/stellar/platform-wallet/setup-multisig`

Configures the platform fee wallet with multi-signature authorization.

**Authentication**: Required (Admin only)

**Request Body**: None

**Response**:
```json
{
  "success": true,
  "data": {
    "platformPublicKey": "G...",
    "signers": ["G...", "G..."],
    "transactionThreshold": 2
  }
}
```

**Error Responses**:
- `400`: Multi-sig setup failed (e.g., signers not configured)
- `403`: User is not an admin

### Get Multi-Signature Configuration

**GET** `/stellar/platform-wallet/multisig-config`

Retrieves the current multi-signature configuration of the platform fee wallet for audit purposes.

**Authentication**: Required (Admin only)

**Request Body**: None

**Response**:
```json
{
  "success": true,
  "data": {
    "publicKey": "G...",
    "signers": [
      {
        "key": "G...",
        "weight": 1
      },
      {
        "key": "G...",
        "weight": 1
      },
      {
        "key": "G...",
        "weight": 1
      }
    ],
    "thresholds": {
      "low": 1,
      "med": 2,
      "high": 2
    }
  }
}
```

**Error Responses**:
- `400`: Failed to retrieve configuration
- `403`: User is not an admin

## Implementation Details

### StellarService Methods

#### `setupPlatformMultiSig()`

Configures multi-signature authorization for the platform fee wallet. This method:

1. Validates that multi-sig signers are configured
2. Loads the platform account from Stellar
3. Creates two transactions:
   - First transaction: Adds the first signer and sets thresholds
   - Second transaction: Adds the second signer
4. Signs and submits both transactions
5. Logs the configuration for audit purposes

#### `getPlatformMultiSigConfig()`

Retrieves the current multi-signature configuration by:

1. Loading the platform account from Stellar
2. Extracting signer information and thresholds
3. Returning the configuration in a structured format

#### `getPlatformPublicKey()`

Returns the platform fee wallet's public key. Used by other services to identify the platform account.

#### `initializeMultiSigSigners()`

Initializes the multi-sig signer keypairs during service initialization:

1. Reads signer keys from environment variables
2. Validates the keys are valid Stellar secret keys
3. Stores them for use during multi-sig setup
4. Warns if not configured in production environments

## Security Considerations

### Key Management Best Practices

1. **Secure Storage**: Store signer secret keys in a secure key management system (KMS) or hardware wallet
2. **Key Separation**: Store each signer key separately to prevent compromise of multiple keys
3. **Access Control**: Limit access to signer keys to authorized personnel only
4. **Backup**: Create secure backups of signer keys for recovery purposes
5. **Rotation**: Periodically rotate signer keys to maintain security

### Signing Transactions

When transferring platform fees or executing sensitive operations:

1. Build the transaction on the platform account
2. Each signer must independently sign the transaction using their secret key
3. Combine all signatures into the transaction envelope
4. Submit the signed transaction to the Stellar network

### Auditing

The platform fee wallet configuration can be audited by:

1. Querying the Stellar Horizon API directly
2. Using the `/stellar/platform-wallet/multisig-config` endpoint
3. Verifying signer public keys and thresholds match the expected configuration

## Testing

### Unit Tests

Tests for multi-sig setup are located in `stellar.service.spec.ts`:

```typescript
describe('Multi-Signature Setup', () => {
  it('should initialize multi-sig signers from environment', () => {
    // Test signer initialization
  });

  it('should return platform public key', () => {
    // Test getPlatformPublicKey()
  });

  it('should retrieve multi-sig configuration', () => {
    // Test getPlatformMultiSigConfig()
  });
});
```

### Integration Tests

To test multi-sig setup on testnet:

1. Configure test signer keys in `.env.test`
2. Fund the platform account with Friendbot
3. Execute `setupPlatformMultiSig()` endpoint
4. Verify configuration with `getPlatformMultiSigConfig()` endpoint
5. Attempt to submit transactions signed with insufficient signatures (should fail)

## Migration Guide

### For Production Deployment

1. **Generate Signer Keys**: Create three separate keypairs (master + 2 signers)
2. **Secure Key Storage**: Store signer keys in HSM or secure KMS
3. **Configure Environment**: Set `STELLAR_MULTISIG_SIGNER_1_SECRET` and `STELLAR_MULTISIG_SIGNER_2_SECRET`
4. **Backup Configuration**: Document signer public keys for audit trail
5. **Execute Setup**: Call `/stellar/platform-wallet/setup-multisig` endpoint
6. **Verify Configuration**: Call `/stellar/platform-wallet/multisig-config` endpoint
7. **Test Transfers**: Execute a test transfer requiring both signers

## References

- [Stellar Multi-Signature Documentation](https://developers.stellar.org/learn/encyclopedia/security-multisig)
- [Stellar Transaction Operations](https://developers.stellar.org/learn/encyclopedia/list-of-operations)
- [Stellar SDK JavaScript](https://github.com/stellar/js-stellar-sdk)
