# Local Development Setup

This guide provides a predictable starting point for the Agri-Fi services without relying on production configuration.

## Prerequisites

Install the versions required by the repository and ensure Docker Desktop is running. The local stack includes PostgreSQL, Redis, RabbitMQ, ClamAV, a Soroban RPC container, and supporting monitoring services.

## Configuration

1. Copy the backend example environment file to a local `.env` file and supply development-only credentials.
2. Keep local secrets, testnet keys, and generated configuration outside version control.
3. Use the local service host names exposed by `docker-compose.yml` when a process runs inside Docker; use the published localhost ports when it runs on the host.

The default local endpoints exposed by the compose stack are:

| Service | Address |
| --- | --- |
| PostgreSQL | `localhost:5432` |
| Redis | `localhost:6379` |
| RabbitMQ | `localhost:5672` |
| RabbitMQ management | `http://localhost:15672` |
| Soroban RPC | `http://localhost:8000` |
| ClamAV | `localhost:3310` |

## Start The Supporting Services

From the repository root, bring up the compose services required for backend development. Wait for PostgreSQL, Redis, RabbitMQ, and ClamAV to become healthy before running database migrations or starting the API.

The Soroban container is configured for a standalone workflow. Confirm that the frontend and backend use the same Stellar network and RPC URL before attempting wallet or contract interactions.

## Application Workflow

1. Install each application package using its checked-in lockfile.
2. Run the backend migration command defined by the backend package scripts after PostgreSQL is available.
3. Start the backend and frontend using their repository scripts in separate terminals.
4. Connect Freighter to the network configured by the active environment file. Never use a production secret key for local development.

## Troubleshooting

- **Port already in use:** stop the conflicting local process or change the published compose port before starting the stack.
- **Database connection refused:** confirm the PostgreSQL container is healthy and that the host, port, user, password, and database name match the local environment file.
- **Queue connection errors:** verify RabbitMQ is healthy and use `amqp://guest:guest@localhost:5672` from a host process or the Docker service hostname from a container.
- **Wallet or transaction failure:** confirm Freighter, the frontend network setting, Horizon, and Soroban RPC are all pointed at the same network.
- **Soroban RPC unavailable:** check the `soroban-rpc` service and use its published port `8000` from host-based tools.

## Safety Notes

Use only local or testnet accounts. Do not commit `.env` files, wallet secrets, access tokens, or service credentials. Reset local volumes only when the development data is disposable.