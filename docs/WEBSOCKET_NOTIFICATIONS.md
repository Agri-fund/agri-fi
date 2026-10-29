# WebSocket Notification Architecture

AgriFi uses Socket.IO with a NestJS gateway under the `/notifications` namespace. Authenticated clients receive a JWT in the Socket.IO handshake, and invalid or expired tokens fall back to anonymous access only for public funding-progress rooms.

## Event Types

- `deal.status_changed` - Deal funding, delivery, or completion changes.
- `milestone.reached` - A shipment milestone is persisted successfully.
- `investment.confirmed` - An investor's pending investment is confirmed on-chain.
- `escrow.released` - Escrow payout processing completes and the deal is completed.

## Rooms

- `user:<userId>` - Private authenticated notification events.
- `deal:<dealId>` - Deal-specific status and milestone updates.
- `deal_funding_progress` - Public deal-funding events.

Clients must not subscribe to another user's `user:` room. Sensitive user and deal rooms require an authenticated socket.

## Delivery and Persistence

Named real-time events are emitted after database or transaction success. Persistent notification history continues to use the notifications repository, unread count API, and existing notification preferences. Browser push delivery uses the existing Web Push/VAPID implementation.

## Reconnection

The frontend notification client enables Socket.IO reconnection with exponential backoff from 500 milliseconds up to 10 seconds, with a maximum of 10 attempts. On reconnect, the server returns the current unread count.

## Rate Limiting

The notification namespace limits each authenticated user to a configurable number of concurrent connections. Set `WS_MAX_CONNECTIONS_PER_USER` to override the default of 10. Excess connections receive `rate_limit_error` and are disconnected.

## Scaling

For multi-instance deployments, use the Socket.IO Redis adapter with the shared Redis service. RabbitMQ remains the source for domain and background job events; Redis provides Socket.IO room-state fan-out across replicas.

## Testing

- Backend gateway and JWT guard unit tests cover authentication and room access.
- Frontend NotificationBell tests should cover unread updates and each named event.
- Load tests must verify stable behavior at 1000 concurrent authenticated connections and per-user connection limits.
