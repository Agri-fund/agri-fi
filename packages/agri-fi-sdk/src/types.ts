/**
 * SDK Core Type Definitions
 */

export interface AgriFiClientConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface DealListParams {
  limit?: number;
  offset?: number;
  commodity?: string;
  status?: 'open' | 'funded' | 'delivered' | 'completed';
  search?: string;
}

export interface TradeDealSummary {
  id: string;
  title: string | null;
  commodity: string;
  country: string | null;
  region: string | null;
  totalValue: number;
  totalInvested: number;
  tokenCount: number;
  expectedRoi: number | null;
  durationDays: number | null;
  riskRating: string | null;
  status: string;
}

export interface TradeDealDetail extends TradeDealSummary {
  shortDescription: string | null;
  longDescription: string | null;
  farmLocation: string | null;
  onChainContractAddress: string | null;
  milestones?: Array<{
    id: string;
    title: string;
    description: string;
    targetDate: string;
    tranchePercent: number;
    isCompleted: boolean;
  }>;
}

export interface PaginatedResponse<T> {
  object: 'list';
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface WebhookSubscriptionInput {
  url: string;
  events: string[];
  secret: string;
  description?: string;
}

export interface WebhookSubscription {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt?: string;
}

export interface WebhookEvent<T = Record<string, unknown>> {
  id: string;
  event: string;
  timestamp: string;
  data: T;
}
