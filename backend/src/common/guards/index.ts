/**
 * Shared guards barrel file.
 *
 * All guards should be imported from this barrel to ensure consistent imports
 * across the codebase and avoid import path errors.
 *
 * @example
 * import { RolesGuard, JwtAuthGuard, OptionalJwtGuard } from '@/common/guards';
 *
 * @see CONTRIBUTING.md - "import guards only from the barrel"
 */

// Auth guards
export { RolesGuard } from '../../auth/guards/roles.guard';
export { MfaGuard } from '../../auth/guards/mfa.guard';
export { ApiKeyGuard } from '../../auth/guards/api-key.guard';
export { StellarWalletGuard } from '../../auth/guards/stellar-wallet.guard';
export { AdminGuard } from '../../auth/guards/admin.guard';

// Auth module-level guards
export { OptionalJwtGuard } from '../../auth/optional-jwt.guard';
export { KycGuard } from '../../auth/kyc.guard';

// Common guards
export { ThrottlerGuard } from '@nestjs/throttler';

// GraphQL guards
export { GraphQLAuthGuard } from '../../graphql/graphql.auth.guard';
export { GraphQLThrottlerGuard } from '../../graphql/graphql.throttler.guard';

// Other guards
export { WebhookSignatureGuard } from '../../auth/webhook-signature.guard';
export { MetricsIpGuard } from '../../metrics/metrics-ip.guard';
export { WsJwtGuard } from '../../notifications/ws-jwt.guard';
export { TradeDealsGuard } from '../../trade-deals/trade-deals.guard';
