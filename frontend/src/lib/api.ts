const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// ── Types ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  role: "farmer" | "trader" | "investor";
  name?: string;
  kycStatus?: string;
  walletAddress?: string | null;
}

export interface Document {
  id: string;
  doc_type: string;
  ipfs_hash: string;
  storage_url: string;
  created_at: string;
}

export interface Milestone {
  id: string;
  milestone?: "farm" | "warehouse" | "port" | "importer";
  title?: string;
  status?: string;
  notes: string | null;
  recorded_at: string;
  created_at: string;
}

export interface Deal {
  id: string;
  commodity: string;
  quantity: number;
  quantity_unit: string;
  total_value: number;
  funded_amount: number;
  total_invested: number;
  token_symbol: string;
  status: "draft" | "open" | "funded" | "delivered" | "completed" | "failed";
  delivery_date: string;
  created_at: string;
  documents?: Document[];
  milestones?: Milestone[];
}

export type TradeDeal = Deal;

export interface Investment {
  id: string;
  trade_deal_id: string;
  investor_id: string;
  token_amount: number;
  amount_usd: number;
  amount_invested: number;
  token_holdings: number;
  status: "pending" | "confirmed" | "failed";
  created_at: string;
  deal: Deal;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

function unwrapPaginated<T>(response: T[] | PaginatedResponse<T>): T[] {
  return Array.isArray(response) ? response : response.data;
}

function normalizeInvestment(investment: any): Investment {
  const tradeDeal = investment.tradeDeal ?? investment.deal ?? {};
  const amount = Number(investment.amount_usd ?? investment.amountUsd ?? 0);
  const tokens = Number(investment.token_amount ?? investment.tokenAmount ?? 0);

  return {
    id: investment.id,
    trade_deal_id: investment.trade_deal_id ?? investment.tradeDealId,
    investor_id: investment.investor_id ?? investment.investorId,
    token_amount: tokens,
    amount_usd: amount,
    amount_invested: Number(investment.amount_invested ?? amount),
    token_holdings: Number(investment.token_holdings ?? tokens),
    status: investment.status,
    created_at: investment.created_at ?? investment.createdAt,
    deal: {
      id: tradeDeal.id ?? investment.trade_deal_id ?? investment.tradeDealId,
      commodity: tradeDeal.commodity ?? "Unknown",
      quantity: Number(tradeDeal.quantity ?? 0),
      quantity_unit:
        tradeDeal.quantity_unit ?? tradeDeal.quantityUnit ?? "units",
      total_value: Number(tradeDeal.total_value ?? tradeDeal.totalValue ?? 0),
      funded_amount: Number(
        tradeDeal.funded_amount ??
          tradeDeal.total_invested ??
          tradeDeal.totalInvested ??
          0,
      ),
      total_invested: Number(
        tradeDeal.total_invested ?? tradeDeal.totalInvested ?? 0,
      ),
      token_symbol: tradeDeal.token_symbol ?? tradeDeal.tokenSymbol ?? "",
      status: tradeDeal.status ?? "draft",
      delivery_date: tradeDeal.delivery_date ?? tradeDeal.deliveryDate ?? "",
      created_at: tradeDeal.created_at ?? tradeDeal.createdAt ?? "",
      documents: tradeDeal.documents,
      milestones: tradeDeal.milestones,
    },
  };
}

// ── Auth-aware fetch helper ───────────────────────────────────────────────────

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("auth_token");
}

function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err: any = new Error(body?.message ?? res.statusText);
    err.response = { status: res.status, data: body };
    throw err;
  }
  return res.json();
}

// ── Stateful API client (used by dashboard / login pages) ────────────────────

export const apiClient = {
  setAuth(token: string, user: User) {
    localStorage.setItem("auth_token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
  },

  clearAuth() {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
  },

  getCurrentUser(): User | null {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem("auth_user");
    return raw ? (JSON.parse(raw) as User) : null;
  },

  // GET /users/me/deals
  async getFarmerDeals(): Promise<Deal[]> {
    return apiFetch<Deal[]>("/users/me/deals");
  },

  // GET /users/me/deals
  async getTraderDeals(): Promise<Deal[]> {
    return apiFetch<Deal[]>("/users/me/deals");
  },

  // GET /investments/my-investments
  async getInvestorInvestments(): Promise<Investment[]> {
    const response = await apiFetch<Investment[] | PaginatedResponse<any>>(
      "/investments/my-investments",
    );
    return unwrapPaginated(response).map(normalizeInvestment);
  },

  // POST /shipments/milestones  — trade_deal_id + milestone + notes in body
  async recordMilestone(
    dealId: string,
    data: {
      milestone: "farm" | "warehouse" | "port" | "importer";
      notes?: string;
    },
  ) {
    return apiFetch("/shipments/milestones", {
      method: "POST",
      body: JSON.stringify({ trade_deal_id: dealId, ...data }),
    });
  },
};

// ── Public marketplace helpers ────────────────────────────────────────────────

export async function getOpenDeals(): Promise<Deal[]> {
  const res = await fetch(`${API_BASE}/trade-deals`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch deals");
  return unwrapPaginated(await res.json());
}

export async function getDealById(id: string): Promise<Deal | null> {
  try {
    return await apiFetch<Deal>(`/trade-deals/${id}`);
  } catch (err: any) {
    if (err?.response?.status === 404) return null;
    throw err;
  }
}
