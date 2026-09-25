import {
  AgriFiClientConfig,
  DealListParams,
  PaginatedResponse,
  TradeDealDetail,
  TradeDealSummary,
  WebhookSubscription,
  WebhookSubscriptionInput,
} from './types';

export class AgriFiApiError extends Error {
  public readonly status: number;
  public readonly data: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = 'AgriFiApiError';
    this.status = status;
    this.data = data;
  }
}

export class AgriFiRateLimitError extends AgriFiApiError {
  public readonly retryAfterSeconds?: number;

  constructor(message: string, retryAfterSeconds?: number) {
    super(message, 429);
    this.name = 'AgriFiRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class AgriFiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  public readonly deals: {
    list: (params?: DealListParams) => Promise<PaginatedResponse<TradeDealSummary>>;
    get: (id: string) => Promise<TradeDealDetail>;
  };

  public readonly webhooks: {
    subscribe: (input: WebhookSubscriptionInput) => Promise<WebhookSubscription>;
    list: () => Promise<PaginatedResponse<WebhookSubscription>>;
    unsubscribe: (id: string) => Promise<void>;
  };

  constructor(config: AgriFiClientConfig) {
    if (!config.apiKey || !config.apiKey.startsWith('agfi_live_')) {
      throw new Error('AgriFiClient requires a valid API key starting with "agfi_live_"');
    }

    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || 'https://api.agri-fi.io').replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs || 15000;

    this.deals = {
      list: (params?: DealListParams) => this.listDeals(params),
      get: (id: string) => this.getDeal(id),
    };

    this.webhooks = {
      subscribe: (input: WebhookSubscriptionInput) => this.subscribeWebhook(input),
      list: () => this.listWebhooks(),
      unsubscribe: (id: string) => this.unsubscribeWebhook(id),
    };
  }

  private async request<T>(path: string, options: { method?: string; body?: any } = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const method = options.method || 'GET';
    const headers: Record<string, string> = {
      'x-api-key': this.apiKey,
      'Accept': 'application/json',
      'User-Agent': 'AgriFi-TS-SDK/1.0.0',
    };

    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const seconds = retryAfter ? parseInt(retryAfter, 10) : undefined;
        throw new AgriFiRateLimitError(
          'API rate limit exceeded. Please back off and retry.',
          seconds,
        );
      }

      if (response.status === 204) {
        return undefined as unknown as T;
      }

      const json = await response.json().catch(() => null);

      if (!response.ok) {
        const message = json?.message || `Request failed with status ${response.status}`;
        throw new AgriFiApiError(message, response.status, json);
      }

      return json as T;
    } catch (err: any) {
      clearTimeout(timer);
      if (err instanceof AgriFiApiError) {
        throw err;
      }
      throw new AgriFiApiError(`Network error: ${err.message}`, 0);
    }
  }

  private async listDeals(params?: DealListParams): Promise<PaginatedResponse<TradeDealSummary>> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());
    if (params?.commodity) searchParams.set('commodity', params.commodity);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.search) searchParams.set('search', params.search);

    const query = searchParams.toString();
    const endpoint = `/v1/public/deals${query ? `?${query}` : ''}`;
    return this.request<PaginatedResponse<TradeDealSummary>>(endpoint);
  }

  private async getDeal(id: string): Promise<TradeDealDetail> {
    return this.request<TradeDealDetail>(`/v1/public/deals/${encodeURIComponent(id)}`);
  }

  private async subscribeWebhook(input: WebhookSubscriptionInput): Promise<WebhookSubscription> {
    return this.request<WebhookSubscription>('/v1/public/webhooks', {
      method: 'POST',
      body: input,
    });
  }

  private async listWebhooks(): Promise<PaginatedResponse<WebhookSubscription>> {
    return this.request<PaginatedResponse<WebhookSubscription>>('/v1/public/webhooks');
  }

  private async unsubscribeWebhook(id: string): Promise<void> {
    await this.request<void>(`/v1/public/webhooks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }
}
