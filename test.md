Context
The docker-compose.yml starts all services simultaneously. The backend NestJS app will attempt to connect to PostgreSQL and RabbitMQ before they finish initialising, causing startup errors like ECONNREFUSED or Connection refused. Developers running docker-compose up for the first time will see the backend crash and need to restart it manually.

Fix
Add health checks and depends_on conditions:

backend:
  depends_on:
    postgres:
      condition: service_healthy
    rabbitmq:
      condition: service_healthy
postgres:
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U postgres"]
    interval: 5s
    timeout: 5s
    retries: 5
Acceptance Criteria
 docker-compose up starts all services in the correct order
 Backend does not crash on first startup due to dependency unavailability
 Health checks are defined for PostgreSQL and RabbitMQ

 READM FILE

 agri-fi
eates a trade deal for agricultural produce (e.g. 10 tons of cocoa) and uploads supporting documents 2. The platform issues a Stellar asset (Trade_Token) representing fractional ownership — each token = $100 USD 3. Investors fund the deal by purchasing tokens; funds are held in a Stellar escrow account 4. The trader records shipment milestones (Farm → Warehouse → Port → Importer) on-chain 5. When the Importer milestone is confirmed, escrow is automatically released: farmer gets 98%, investors get their proportional share, platform takes 2%

Tech stack
Layer	Technology
Frontend	Next.js 14, Tailwind CSS, Freighter wallet
Backend	NestJS, TypeScript
Database	PostgreSQL (TypeORM)
Queue	RabbitMQ
Blockchain	Stellar (Horizon API, stellar-sdk)
Storage	IPFS (web3.storage) with S3 fallback
Project structure
.
├── backend/          # NestJS REST API
│   └── src/
│       ├── auth/         # Registration, login, KYC, JWT
│       ├── stellar/      # Stellar SDK wrapper
│       ├── queue/        # RabbitMQ async jobs
│       └── database/     # TypeORM config + migrations
├── frontend/         # Next.js app
│   └── src/app/
├── docker-compose.yml  # PostgreSQL + RabbitMQ
└── .kiro/specs/        # Feature specs and implementation plan
Quick start
Prerequisites
Node.js >= 20
Docker + Docker Compose
A Stellar testnet keypair funded via Friendbot
1. Start infrastructure
docker compose up -d
2. Configure environment
cp backend/.env.example backend/.env
# Fill in JWT_SECRET, STELLAR_PLATFORM_SECRET, and other required values
3. Install dependencies and run migrations
cd backend && npm install && npm run migration:run
cd ../frontend && npm install
4. Start the servers
# Backend — http://localhost:3001
cd backend && npm run start:dev

# Frontend — http://localhost:3000
cd frontend && npm run dev
API overview
Method	Endpoint	Description
POST	/auth/register	Register as farmer, trader, or investor
POST	/auth/login	Get JWT access token
POST	/auth/kyc	Submit KYC documents
POST	/auth/wallet	Link Stellar wallet address
POST	/trade-deals	Create a draft trade deal (trader)
POST	/trade-deals/:id/publish	Publish deal and issue Trade_Token
GET	/trade-deals	List open deals (marketplace)
GET	/trade-deals/:id	Deal detail with documents and milestones
POST	/documents	Upload trade document (IPFS + Stellar anchor)
POST	/investments	Fund a trade deal (investor)
POST	/shipments/milestones	Record a shipment milestone (trader)
GET	/shipments/:trade_deal_id	List milestones for a deal
GET	/users/me/deals	Farmer/trader dashboard data
GET	/users/me/investments	Investor dashboard data
User roles
Farmer — lists produce, receives payment on delivery
Trader — creates trade deals, manages shipments
Investor — funds deals by purchasing Trade_Tokens, earns returns on completion
All users must complete KYC before participating in trade deals or investments.

Stellar integration
Each trade deal gets a unique issuer keypair and escrow account on Stellar testnet
Trade_Tokens are Stellar custom assets (e.g. COCOA1002) minted to the escrow account
Document hashes and shipment milestones are anchored on-chain via Stellar memo transactions
Escrow release is a single multi-operation transaction: farmer payment + investor distributions + platform fee
All Stellar operations are async via RabbitMQ with up to 3 retries on failure
All blockchain interactions target Stellar testnet by default. Set STELLAR_NETWORK=mainnet to switch.

Testing
cd backend && npm test
The backend uses Jest for unit tests and fast-check for property-based tests. Key correctness properties verified:

Token count = floor(total_value / 100)
Sum of confirmed investments = total_invested
Investments never exceed total_value
Farmer + investors + platform fee = total_value
Platform fee = total_value * 0.02
Milestones always follow the sequence: Farm → Warehouse → Port → Importer



I am working on a project with a team of software engineers on an open source project. I want you to take the role of a web developer with more than 15 years of experience to help me on my assingment that is required for the project. You are to execute only what required in this assignment of this project. You must provide a step-by-step process for me to test that i have successfully completed my assignment. Remember, you a web developer with more than 15 years of experience so as to help me on my assingment that is required for the project and you are to execute only what required in this assignment of this project.

