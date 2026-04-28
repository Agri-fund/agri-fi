const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// ── Types ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  role: "farmer" | "trader" | "investor" | "company_admin" | "admin";
  name?: string;
  kycStatus?: string;
  walletAddress?: string | null;
  isCompany?: boolean;
  companyDetails?: {
    companyName?: string;
    registrationNumber?: string;
    articlesOfIncorporationUrl?: string;
  } | null;
}

export interface Document {
  id: string;
  doc_type: string;
  ipfs_hash: string;
  storage_url: string;
  created_at: string;
}

export type MilestoneType = "farm" | "warehouse" | "port" | "importer";

export const MILESTONE_LABELS: Record<MilestoneType, string> = {
  farm: "Farm",
  warehouse: "Warehouse",
  port: "Port",
  importer: "Importer",
};

export interface Milestone {
  id: string;
  milestone: MilestoneType;
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
  issuer_public_key?: string | null;
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
  expected_return_usd: number;
  actual_return_usd: number | null;
  return_percentage: number | null;
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
    expected_return_usd: Number(
      investment.expected_return_usd ?? investment.expectedReturnUsd ?? 0,
    ),
    actual_return_usd:
      investment.actual_return_usd ?? investment.actualReturnUsd ?? null,
    return_percentage:
      investment.return_percentage ?? investment.returnPercentage ?? null,
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
      issuer_public_key:
        tradeDeal.issuer_public_key ?? tradeDeal.issuerPublicKey ?? null,
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
  /** Call POST /auth/login, store the returned JWT, and return the token. */
  async login(email: string, password: string): Promise<string> {
    const { accessToken } = await apiFetch<{ accessToken: string }>(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ email, password }),
      },
    );
    localStorage.setItem("auth_token", accessToken);
    return accessToken;
  },

  /** Fetch the authenticated user's profile from GET /users/me. */
  async getMe(): Promise<User> {
    const user = await apiFetch<User>("/users/me");
    localStorage.setItem("auth_user", JSON.stringify(user));
    return user;
  },

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

  // GET /users/me — fetch the up-to-date profile from the server and refresh
  // the cached copy in localStorage so KYC, wallet, and role changes made by
  // an admin are picked up without forcing a logout.
  async refreshCurrentUser(): Promise<User | null> {
    if (typeof window === "undefined") return null;
    if (!getStoredToken()) return null;
    try {
      const fresh = await apiFetch<User>("/users/me");
      localStorage.setItem("auth_user", JSON.stringify(fresh));
      return fresh;
    } catch (err: any) {
      if (err?.response?.status === 401) {
        this.clearAuth();
      }
      throw err;
    }
  },

  // GET /users/me/deals
  async getFarmerDeals(): Promise<Deal[]> {
    return apiFetch<Deal[]>("/users/me/deals?role=farmer");
  },

  // GET /users/me/deals
  async getTraderDeals(): Promise<Deal[]> {
    return apiFetch<Deal[]>("/users/me/deals?role=trader");
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

  // POST /auth/kyc
  async submitKyc(data: {
    governmentIdUrl?: string;
    proofOfAddressUrl?: string;
    isCorporate?: boolean;
    companyName?: string;
    registrationNumber?: string;
    businessLicenseUrl?: string;
    articlesOfIncorporationUrl?: string;
  }): Promise<{ kycStatus: string }> {
    return apiFetch("/auth/kyc", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  // POST /auth/logout — invalidate the current JWT by incrementing tokenVersion
  async logout(): Promise<{ message: string }> {
    try {
      return await apiFetch("/auth/logout", {
        method: "POST",
      });
    } finally {
      // Always clear local auth state, even if logout request fails
      this.clearAuth();
    }
  },
};

// ── Public marketplace helpers ────────────────────────────────────────────────

export interface PaginatedDeals {
  data: Deal[];
  total: number;
  page: number;
  limit: number;
}

export async function getOpenDeals(page = 1, limit = 12): Promise<PaginatedDeals> {
  const res = await fetch(`${API_BASE}/trade-deals?page=${page}&limit=${limit}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch deals');
  return res.json();
}

export async function getDealById(id: string): Promise<Deal | null> {
  try {
    return await apiFetch<Deal>(`/trade-deals/${id}`);
  } catch (err: any) {
    if (err?.response?.status === 404) return null;
    throw err;
  }
}
