# Stellar Wallet Integration

This document describes the Stellar wallet integration implemented for the Agri-Fi platform.

## Features Implemented

### 1. Wallet Connection
- **Connect Wallet** button in navigation bar for authenticated users
- Freighter wallet integration as primary wallet
- Fallback message with installation link if Freighter not available
- Wallet connection state persisted and re-checked on page load
- Connected wallet address displayed (truncated) in navigation

### 2. Wallet Linking
- Automatic linking of connected wallet address to user account
- POST /auth/wallet endpoint integration
- Error handling for authentication and linking failures

### 3. Investment Transaction Signing
- Investment form on deal detail pages
- Token quantity input with validation
- Two-step investment process:
  1. Create pending investment (POST /investments)
  2. Sign transaction with Freighter and submit (POST /investments/:id/submit-tx)
- Success/error state handling
- Transaction confirmation display

## Components Created

### `useWallet` Hook (`frontend/src/hooks/useWallet.ts`)
- Manages wallet connection state
- Handles Freighter API interactions
- Provides connect, disconnect, and signTransaction methods
- Error handling and loading states

### `WalletButton` Component (`frontend/src/components/WalletButton.tsx`)
- Connect/disconnect wallet functionality
- Displays connected wallet address
- Automatic wallet linking to user account
- Error handling with Freighter installation link

### `InvestmentForm` Component (`frontend/src/components/InvestmentForm.tsx`)
- Token quantity input with validation
- Investment amount calculation
- Two-step transaction process
- Success confirmation with transaction details
- Error handling for failed transactions

### Deal Detail Page (`frontend/src/app/marketplace/[id]/page.tsx`)
- Displays trade deal information
- Funding progress visualization
- Integrated investment form
- Responsive design

## Backend Endpoints Added

### Investment Controller (`backend/src/investments/`)
- `POST /investments` - Create pending investment and return unsigned XDR
- `POST /investments/:id/submit-tx` - Submit signed transaction

### Stellar Service Extensions
- `createInvestmentTransaction()` - Generate unsigned XDR for investments
- `submitTransaction()` - Submit signed XDR to Stellar network

## API Routes (Next.js)
- `/api/auth/wallet` - Proxy to backend wallet linking
- `/api/investments` - Proxy to backend investment creation
- `/api/investments/[id]/submit-tx` - Proxy to backend transaction submission
- `/api/trade-deals/[id]` - Proxy to backend deal details

## Usage Instructions

### For Users
1. Install Freighter wallet extension
2. Switch Freighter to Stellar testnet
3. Connect wallet using the button in navigation
4. Navigate to a trade deal page
5. Use the investment form to fund deals

### For Developers
1. Start backend: `cd backend && npm run start:dev`
2. Start frontend: `cd frontend && npm run dev`
3. Ensure environment variables are set:
   - Backend: `STELLAR_NETWORK=testnet`
   - Frontend: `BACKEND_URL=http://localhost:3001`

## Security Considerations

- All transactions are signed client-side by user's wallet
- Private keys never leave the user's browser
- Backend only handles unsigned XDR generation and signed transaction submission
- JWT authentication required for all investment operations
- Wallet address validation and uniqueness enforced

## Testing

To test the wallet integration:
1. Create a test user account
2. Connect Freighter wallet (testnet)
3. Navigate to a published trade deal
4. Attempt to invest using the form
5. Verify transaction appears in Freighter for signing
6. Confirm successful investment and token allocation

## Future Enhancements

- Albedo wallet fallback support
- Multi-signature transaction support
- Transaction history display
- Wallet balance checking
- Gas fee estimation