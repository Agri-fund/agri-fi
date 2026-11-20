import { apiClient } from './api.client';

export interface Anchor {
  id: string;
  name: string;
  homeDomain?: string;
  interactiveUrl: string;
  depositSupported?: boolean;
  withdrawSupported?: boolean;
  assets?: string[];
}

export type Sep24Flow = 'deposit' | 'withdraw';

export type Sep24Status =
  | 'incomplete'
  | 'pending_user_transfer_start'
  | 'pending_user_transfer_complete'
  | 'pending_anchor'
  | 'pending_stellar'
  | 'pending_external'
  | 'pending_trust'
  | 'needs_more_info'
  | 'completed'
  | 'refunded'
  | 'expired'
  | 'error';

export interface Sep24Transaction {
  id: string;
  status: Sep24Status;
  kind?: Sep24Flow;
  amountIn?: string;
  amountOut?: string;
  assetCode?: string;
  message?: string;
  moreInfoUrl?: string;
  interactiveUrl?: string;
  updatedAt?: string;
}

export interface InitiateSep24Params {
  anchorId: string;
  flow: Sep24Flow;
  assetCode?: string;
  amount?: string;
}

export interface InitiateSep24Response {
  id: string;
  interactiveUrl: string;
  status: Sep24Status;
}

export const stellarService = {
  async listAnchors(): Promise<Anchor[]> {
    const { data } = await apiClient.get<Anchor[] | { anchors: Anchor[] }>(
      '/v1/stellar/anchors',
    );
    return Array.isArray(data) ? data : data.anchors ?? [];
  },

  async initiateSep24(
    params: InitiateSep24Params,
  ): Promise<InitiateSep24Response> {
    const { data } = await apiClient.post<InitiateSep24Response>(
      '/v1/stellar/sep24/transactions',
      params,
    );
    return data;
  },

  async getTransaction(id: string): Promise<Sep24Transaction> {
    const { data } = await apiClient.get<Sep24Transaction>(
      `/v1/stellar/transactions/${encodeURIComponent(id)}`,
    );
    return data;
  },

  async getUsdcBalance(): Promise<string> {
    const { data } = await apiClient.get<{ balance: string }>(
      '/v1/stellar/balance',
    );
    return data.balance;
  },
};
