# Agri-Fi Frontend

The web application for the Agri-Fi agricultural trade financing platform, built with **Next.js 14 (App Router)**, **Tailwind CSS**, and **Stellar / Soroban** wallet integrations.

---

## Documentation Quick Links

- 📚 **[Component Library & Patterns Guide](docs/component-library.md)**: Reusable UI primitives (`components/ui/*`), custom hooks catalog (`hooks/*`), and API client patterns (`lib/api.ts`).
- 📱 **[PWA & Offline Guide](docs/PWA_GUIDE.md)**: Progressive Web App architecture, service worker caching, and offline support.
- ⚙️ **[Environment Variable Reference](../docs/develop/environment.md)**: Full reference for backend and frontend configuration variables.

---

## Features

- **Decentralized Escrow Funding**: Fund agricultural trade deals using Stellar assets and Soroban smart contracts.
- **Multi-Persona Portals**: Dedicated workspaces for Farmers, Commodity Traders, and Institutional/Retail Investors.
- **Shipment Milestone Tracking**: Visual progress indicators and interactive map views tracking cargo from Farm to Importer.
- **Multi-Currency & FX Conversions**: Real-time conversions between USD and African fiat currencies (KES, NGN, GHS, TZS).
- **Stellar Wallet Support**: Seamless signing with Freighter, Albedo, and browser extension wallets.
- **Document Verification**: In-browser PDF inspection for phytosanitary certificates, bills of lading, and inspection reports anchored on IPFS and Stellar.

---

## Directory Structure

```
frontend/
├── docs/                      # Technical documentation
│   ├── component-library.md   # UI component library & hooks reference
│   └── PWA_GUIDE.md           # Progressive Web App guide
├── public/                    # Static assets, manifests, icons
└── src/
    ├── app/                   # Next.js App Router pages and layouts
    ├── components/
    │   ├── deals/             # Trade deal forms, activity feeds, timelines
    │   ├── marketplace/       # Deal cards, investment modals, filters
    │   ├── navigation/        # Header, notification center, drawer
    │   ├── shipments/         # Milestone stepper, IoT telemetry cards
    │   ├── ui/                # Core reusable UI primitives (Input, Select, Modal, etc.)
    │   └── wallet/            # Stellar wallet selection & transaction receipts
    ├── hooks/                 # Custom React hooks (useCurrencyFormat, useWallet, etc.)
    └── lib/                   # API client, Stellar SDK wrappers, cache utilities
```

---

## Getting Started

### 1. Prerequisites
- Node.js >= 20
- pnpm >= 9 (or npm)

### 2. Configure Environment
Copy the example environment file and configure backend endpoints:
```bash
cp .env.local.example .env.local
```

Key frontend variables:
- `NEXT_PUBLIC_API_URL`: Backend REST API URL (default: `http://localhost:3001`).
- `NEXT_PUBLIC_STELLAR_NETWORK`: `testnet` or `mainnet`.
- `NEXT_PUBLIC_USDC_ISSUER`: Stellar account issuing USDC.

### 3. Install Dependencies
```bash
pnpm install
```

### 4. Run Development Server
```bash
pnpm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Code Quality & Conventions

- **Component Design System**: When building or reusing components, adhere strictly to the conventions documented in [`docs/component-library.md`](docs/component-library.md).
- **Linting & Formatting**:
  ```bash
  pnpm run lint
  ```
- **Testing**:
  ```bash
  pnpm run test
  ```
