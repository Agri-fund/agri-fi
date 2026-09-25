# AgriFi GraphQL API Documentation

Welcome to the AgriFi GraphQL API reference. This document provides a complete catalogue of GraphQL queries, mutations, subscriptions, and types available on the platform, along with architectural details covering DataLoader usage, query complexity limits, depth restrictions, authentication, and throttling interplay with RESTful endpoints.

---

## 1. Overview & Architecture

AgriFi provides a code-first GraphQL API built on **NestJS** and **Apollo Server** (`@nestjs/graphql`, `@nestjs/apollo`). It complements the REST API by enabling single-request data retrieval for complex relational graphs (e.g. deals with nested farmers, traders, milestone timelines, and investor stakes).

### Endpoints
- **HTTP / HTTPS**: `POST /graphql` (Queries & Mutations)
- **WebSocket (WSS)**: `GET/WS /graphql` using the modern `graphql-ws` protocol (Real-time Subscriptions)

### Environment Behavior
| Feature | Development / Staging | Production |
|---|---|---|
| Apollo Sandbox / Playground | Enabled (`true`) | Disabled (`false`) |
| Schema Introspection | Enabled (`true`) | Disabled (`false`) |
| Error Stack Traces | Included | Redacted (code and message only) |

---

## 2. Authentication & Authorization

All operations on the GraphQL API are guarded by `GqlAuthGuard` (JWT Bearer Token).

### HTTP Operations (Queries & Mutations)
Include your JWT token in the `Authorization` HTTP header:
```http
Authorization: Bearer <your-jwt-token>
```

### WebSocket Operations (Subscriptions)
Provide the token inside `connectionParams` during connection initialization:
```json
{
  "connectionParams": {
    "Authorization": "Bearer <your-jwt-token>"
  }
}
```

### Role-Based Access Control (RBAC) & Object Ownership
- **User Profile Queries (`Query.user`)**: Platform administrators can query any user profile by UUID. Regular users (farmers, traders, investors) may only query their own user ID (`ForbiddenException` returned otherwise).
- **Investment Queries (`Query.investment`)**: Authenticated investors may only retrieve investments that belong to their own user account (`investorId === currentUser.id`).
- **Investment Mutations (`Mutation.cancelInvestment`)**: Can only be executed by the owning investor on investments in `PENDING` or `CONFIRMED` states.

---

## 3. DataLoaders & N+1 Prevention

To prevent the classic N+1 database round-trip problem when traversing nested entity graphs (e.g., querying 50 deals, each resolving its farmer and trader), AgriFi utilizes **DataLoader**:

1. **Per-Request Isolation**: DataLoaders are instantiated per-request inside the GraphQL context (`GqlContext.loaders`). This guarantees batching within a single request while strictly preventing cross-request cache leakage or stale data between tenants.
2. **`user` DataLoader (`UserDataLoaderService`)**: Batches user IDs (`farmerId`, `traderId`, `investorId`) across all resolvers and loads them in a single `SELECT * FROM users WHERE id IN (...)` SQL query.
3. **`deal` DataLoader (`DealDataLoaderService`)**: Batches deal IDs across investment and milestone resolvers and retrieves them in a single query.

---

## 4. Query Cost, Depth Limits & Throttling

### Query Protection Rules
- **Maximum Depth**: Capped at **5 levels** via `graphql-depth-limit`. Queries attempting deeper nestings (e.g., `deals -> farmer -> deals -> farmer...`) are rejected before execution.
- **Maximum Complexity**: Capped at **200** via `complexityLimitRule`. Each field selection increments the complexity score; requests exceeding 200 return `QUERY_TOO_COMPLEX`.

### Throttler Guard (`GqlThrottlerGuard`)
- Resolves the execution context into the underlying HTTP request.
- **Tracker Key**:
  - Authenticated calls: Keyed on `gql:user:${userId}` (derived from JWT `sub` / `id`).
  - Unauthenticated calls: Falls back to client IP address.

### Throttling Interplay with RESTful Endpoints
Both GraphQL and REST endpoints share the global Redis storage backend for rate limiting, but employ **distinct key namespaces**:
- REST endpoints use `rest:*` or standard controller route signatures.
- GraphQL operations use `gql:user:${userId}` or `gql:ip:${ip}`.

This architectural decoupling ensures:
1. High-frequency polling on REST endpoints does not prematurely exhaust GraphQL rate limits for websocket subscriptions or marketplace browsing.
2. Expensive GraphQL queries cannot be used to exhaust a client's REST rate-limiting allowance.

---

## 5. GraphQL Type Catalogue

### `User`
| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | `ID!` | No | Unique user UUID |
| `email` | `String!` | No | User's verified email address |
| `role` | `String!` | No | Role (`farmer`, `trader`, `investor`, `admin`) |
| `country` | `String!` | No | ISO two-letter country code |
| `kycStatus` | `String!` | No | KYC status (`unverified`, `pending`, `verified`, `rejected`) |
| `walletAddress` | `String` | Yes | Stellar public address |
| `isCompany` | `Boolean!` | No | Whether the user is an entity |
| `isEmailVerified` | `Boolean!` | No | Email verification status |
| `isMfaEnabled` | `Boolean!` | No | Multi-factor authentication flag |
| `creditScore` | `Float` | Yes | Farmer credit score (300-850) |
| `preferredLanguage` | `String!` | No | e.g. `en`, `fr`, `sw` |
| `timezone` | `String` | Yes | User timezone |
| `emailDigestEnabled` | `Boolean!` | No | Email digest preference |
| `createdAt` | `DateTime!` | No | Account registration date |

### `TradeDeal`
| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | `ID!` | No | Deal UUID |
| `commodity` | `String!` | No | Commodity name (e.g. Cocoa, Coffee, Maize) |
| `title` | `String` | Yes | Listing title |
| `description` | `String` | Yes | Listing description |
| `quantity` | `Float!` | No | Total quantity |
| `quantityUnit` | `String!` | No | `kg` or `tons` |
| `totalValue` | `Float!` | No | Total valuation in USD |
| `expectedRoi` | `Float` | Yes | Annualized expected ROI percentage |
| `durationDays` | `Int` | Yes | Total duration in days |
| `tokenCount` | `Int!` | No | On-chain tokens minted |
| `tokenSymbol` | `String!` | No | Asset code (e.g. `COCOA-001`) |
| `status` | `String!` | No | Deal status (`draft`, `open`, `funded`, `delivered`, `completed`, `failed`) |
| `farmerId` | `String!` | No | Farmer UUID |
| `farmer` | `User` | Yes | Resolved via `UserDataLoader` |
| `traderId` | `String!` | No | Trader UUID |
| `trader` | `User` | Yes | Resolved via `UserDataLoader` |
| `escrowPublicKey` | `String` | Yes | Stellar escrow public key |
| `issuerPublicKey` | `String` | Yes | Stellar asset issuer public key |
| `totalInvested` | `Float!` | No | Total funded in USD |
| `deliveryDate` | `DateTime!` | No | Contractual delivery date |
| `riskRating` | `String` | Yes | Derived risk tier (`Low`, `Medium`, `High`, `Very High`) |
| `farmLocation` | `String` | Yes | Text location |
| `farmLatitude` | `Float` | Yes | Farm latitude coordinate |
| `farmLongitude` | `Float` | Yes | Farm longitude coordinate |
| `stellarAssetTxId` | `String` | Yes | Stellar asset minting tx hash |
| `sorobanCampaignContractId` | `String` | Yes | Soroban smart contract ID |
| `riskScore` | `Float` | Yes | Calculated risk score (0-100) |
| `minLotSize` | `Float!` | No | Minimum investment lot (USD) |
| `lotStep` | `Float!` | No | Incremental investment step |
| `settlementStatus` | `String!` | No | `pending`, `settling`, `settled`, `settlement_failed` |
| `settlementTxHash` | `String` | Yes | Stellar payout settlement transaction hash |
| `settledAt` | `DateTime` | Yes | Timestamp when escrow settled |
| `investments` | `[Investment!]` | Yes | Investments placed on this deal |
| `milestones` | `[ShipmentMilestone!]` | Yes | Milestone tracking entries |
| `createdAt` | `DateTime!` | No | Listing timestamp |

### `Investment`
| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | `ID!` | No | Investment UUID |
| `tradeDealId` | `String!` | No | Deal UUID |
| `tradeDeal` | `TradeDeal` | Yes | Resolved via `DealDataLoader` |
| `investorId` | `String!` | No | Investor UUID |
| `investor` | `User` | Yes | Resolved via `UserDataLoader` |
| `tokenAmount` | `Int!` | No | Units of trade tokens acquired |
| `amountUsd` | `Float!` | No | Total dollar amount invested |
| `stellarTxId` | `String` | Yes | Stellar ledger transaction hash |
| `status` | `String!` | No | `pending`, `confirmed`, `cancelled`, `refunded`, `failed` |
| `createdAt` | `DateTime!` | No | Investment creation timestamp |

### `ShipmentMilestone`
| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | `ID!` | No | Milestone UUID |
| `tradeDealId` | `String!` | No | Associated deal UUID |
| `tradeDeal` | `TradeDeal` | Yes | Resolved via `DealDataLoader` |
| `milestone` | `String!` | No | e.g. `harvest_started`, `goods_in_transit`, `customs_cleared` |
| `recordedBy` | `String!` | No | Actor ID who logged milestone |
| `notes` | `String` | Yes | Inspector / logger notes |
| `stellarTxId` | `String` | Yes | On-chain audit transaction |
| `memoText` | `String` | Yes | On-chain memo |
| `latitude` | `Float` | Yes | GPS latitude |
| `longitude` | `Float` | Yes | GPS longitude |
| `recordedAt` | `DateTime!` | No | Timestamp of milestone event |

---

## 6. Query Catalogue

### `user(id: ID!): User`
Fetches a user profile by UUID. Administrators may query any user; regular users may only query their own ID.

### `deals: [TradeDeal!]!`
Lists all marketplace trade deals sorted descending by `createdAt`.

### `deal(id: ID!): TradeDeal!`
Fetches a single trade deal by UUID, including relations.

### `investments: [Investment!]!`
Returns all investments belonging to the currently authenticated user.

### `investment(id: ID!): Investment!`
Fetches a single investment by UUID. Requires ownership by the calling user.

### `shipments(tradeDealId: ID!): [ShipmentMilestone!]!`
Returns chronological shipment milestones for a given trade deal.

---

## 7. Mutation Catalogue

### `createInvestment(input: CreateInvestmentInput!): Investment!`
Places an investment on a trade deal. Automatically dispatches `DEAL_FUNDING_UPDATED` subscription notifications.
```graphql
input CreateInvestmentInput {
  tradeDealId: ID!
  tokenAmount: Int!
  amountUsd: Float!
  complianceData: String
}
```

### `cancelInvestment(id: ID!): Investment!`
Cancels a pending or confirmed investment during cooling-off windows.

---

## 8. Subscription Catalogue

### `dealFundingUpdated(dealId: ID): DealFundingUpdatedPayload!`
Emitted in real-time when an investment is confirmed. Accepts optional `dealId` parameter to filter events to a specific deal.
```graphql
type DealFundingUpdatedPayload {
  dealId: ID!
  totalInvested: Float!
  totalValue: Float!
  fundingPercentage: Float!
  status: String!
}
```

### `paymentDistributed(dealId: ID): PaymentDistributedPayload!`
Emitted when an escrow release distributes funds to the farmer and investors.
```graphql
type PaymentDistributedPayload {
  dealId: ID!
  farmerAmount: Float!
  platformFee: Float!
  totalValue: Float!
  txHash: String!
  distributedAt: DateTime!
}
```

---

## 9. Sample Queries & Flows

### 1. Fetch Current User Profile
```graphql
query GetMyProfile($userId: ID!) {
  user(id: $userId) {
    id
    email
    role
    kycStatus
    creditScore
    walletAddress
  }
}
```

### 2. Marketplace Deals with Farmer and Milestones
```graphql
query GetMarketplaceDeals {
  deals {
    id
    commodity
    totalValue
    totalInvested
    status
    expectedRoi
    farmer {
      id
      country
      creditScore
    }
    milestones {
      milestone
      recordedAt
      latitude
      longitude
    }
  }
}
```

### 3. Fetch Deal Detail with DataLoader Nested Graph
```graphql
query GetDealDetail($id: ID!) {
  deal(id: $id) {
    id
    title
    commodity
    totalValue
    totalInvested
    minLotSize
    lotStep
    riskRating
    riskScore
    farmer {
      id
      country
      kycStatus
    }
    trader {
      id
      email
    }
    investments {
      id
      amountUsd
      tokenAmount
      status
    }
  }
}
```

### 4. Create an Investment
```graphql
mutation PlaceInvestment($input: CreateInvestmentInput!) {
  createInvestment(input: $input) {
    id
    tradeDealId
    amountUsd
    tokenAmount
    status
    createdAt
  }
}
```
Variables:
```json
{
  "input": {
    "tradeDealId": "8f8b6f3c-5899-4d6d-b8d4-f6b986e8a001",
    "tokenAmount": 25,
    "amountUsd": 250.00
  }
}
```

### 5. Subscribe to Real-Time Deal Funding Updates
```graphql
subscription OnDealFunded($dealId: ID!) {
  dealFundingUpdated(dealId: $dealId) {
    dealId
    totalInvested
    totalValue
    fundingPercentage
    status
  }
}
```
