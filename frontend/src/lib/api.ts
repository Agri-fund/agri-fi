import { getAuthToken, setAuthToken, clearAuthToken } from "./auth-token";
import { captureTraceId, traceHeaders } from "./tracing";
import { enqueueOfflineOperation, registerBackgroundSync } from "./offlineQueue";

export const API_BASE =
  (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").replace(/\/+$/, "");
const API_VERSION = "/v1";

// ── Public (no-auth) fetch helper — used by ActivityFeed and other public endpoints ──
export async function apiFetchPublic<T>(path: string): Promise<T> {
  const versionedPath = path.startsWith('/v1') || path.startsWith('/v2')
    ? path
    : `${API_VERSION}${path}`;
  const res = await fetch(`${API_BASE}${versionedPath}`, {
    headers: traceHeaders({ "Content-Type": "application/json" }),
    cache: "no-store",
  });
  captureTraceId(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err: any = new Error(body?.message ?? res.statusText);
    err.response = { status: res.status, data: body };
    throw err;
  }
  return res.json();
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  role: "farmer" | "trader" | "investor" | "company_admin" | "admin";
  name?: string;
  kycStatus?: string;
  isMfaEnabled?: boolean;
  walletAddress?: string | null;
  isCompany?: boolean;
  preferredCurrency?: string;
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
  stellar_tx_id?: string | null;
  recorded_by?: string;
}

export interface Deal {
  id: string;
  title?: string | null;
  commodity: string;
  country?: string | null;
  region?: string | null;
  quantity: number;
  quantity_unit: string;
  total_value: number;
  funded_amount: number;
  total_invested: number;
  token_count: number;
  tokens_remaining: number;
  token_symbol: string;
  issuer_public_key?: string | null;
  status: "draft" | "open" | "funded" | "delivered" | "completed" | "failed";
  delivery_date: string;
  annual_roi?: number;
  term_days?: number;
  expected_roi?: number | null;
  duration_days?: number | null;
  min_investment_lot?: number | null;
  risk_rating?: "Low" | "Medium" | "High" | null;
  short_description?: string | null;
  long_description?: string | null;
  farm_location?: string | null;
  funding_status?: "open" | "almost funded" | "fully funded";
  created_at: string;
  documents?: Document[];
  cover_image_url?: string | null;
  esg_score?: number | null;
  environmental_score?: number | null;
  social_score?: number | null;
  governance_score?: number | null;
  esg_rating?: string | null;
  esg_status?: string | null;
  esg_breakdown?: Record<string, any> | null;
  /** Credit score of the farmer behind the deal (#1160) */
  farmer_credit_score?: number | null;
  /** Credit tier of the farmer behind the deal (#1160) */
  farmer_credit_tier?: CreditScoreTier | null;
}

/** One month of a farmer's credit score history (#1160) */
export interface CreditScoreHistoryPoint {
  month: string;
  score: number;
  tier: CreditScoreTier;
  maxDealSizeUsdc: number;
  change: number | null;
}

/** A farmer's standing against the farmers in their country (#1160) */
export interface CreditScoreBenchmark {
  country: string;
  peerCount: number;
  averageScore: number;
  medianScore: number;
  percentile: number;
  score: number | null;
  tier: CreditScoreTier | null;
  tierDistribution: Record<CreditScoreTier, number>;
}

/** A farmer's challenge to their credit score (#1160) */
export interface CreditScoreDispute {
  id: string;
  userId: string;
  disputedScore: number;
  reason: string;
  factor: string | null;
  status: "open" | "under_review" | "resolved" | "rejected";
  resolution: string | null;
  correctedScore: number | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A deal recommended because of the credit standing of its farmer (#1160) */
export interface CreditInvestmentRecommendation {
  dealId: string;
  commodity: string;
  totalValue: number;
  expectedRoi: number | null;
  farmerCreditScore: number;
  farmerCreditTier: CreditScoreTier;
  maxDealSizeUsdc: number;
  rationale: string;
}

export type CreditScoreTier = "Excellent" | "Good" | "Fair" | "Poor";

export interface CreditScoreDisclosure {
  score: number;
  tier: CreditScoreTier;
  maxDealSizeUsdc: number;
  factors: {
    onTimeRepaymentRate: number;
    dealCompletionRate: number;
    dealDefaultRate: number;
    shipmentMilestoneComplianceRate: number;
    shipmentAccuracyRate: number;
    documentQualityRate: number;
    kycVerificationAgeDays: number;
  };
  breakdown: Record<
    string,
    {
      name: string;
      weightPercent: string;
      scorePercent: number;
      description: string;
      impact: "positive" | "neutral" | "negative";
    }
  >;
  tips: string[];
  lastUpdated: string;
  cached: boolean;
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
  stellar_tx_id?: string | null;
  soroban_contract_id?: string | null;
}

/** One slice of the allocation-by-deal breakdown (#789). */
export interface PortfolioAllocationSlice {
  deal_id: string;
  title: string;
  token_symbol: string | null;
  commodity: string | null;
  deal_status: string | null;
  amount_usd: number;
  share_pct: number;
  expected_return_usd: number;
  realized_return_usd: number | null;
  position_count: number;
}

export interface PortfolioSummary {
  investor_id: string;
  currency: "USD";
  total_invested: number;
  current_value: number;
  expected_returns: number;
  returns_paid: number;
  roi_pct: number;
  active_deal_count: number;
  invested_deal_count: number;
  position_count: number;
  allocation: PortfolioAllocationSlice[];
  generated_at: string;
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
      token_count: Number(tradeDeal.token_count ?? tradeDeal.tokenCount ?? 0),
      tokens_remaining: Number(
        tradeDeal.tokens_remaining ?? tradeDeal.tokensRemaining ?? 0,
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

/**
 * Normalise a raw deal object returned by the backend, ensuring that
 * `funded_amount` is always populated regardless of whether the server sends
 * the field as `funded_amount` or `total_invested`.
 */
function normalizeDeal(raw: any): Deal {
  return {
    id: raw.id,
    title: raw.title ?? null,
    commodity: raw.commodity,
    country: raw.country ?? null,
    region: raw.region ?? null,
    quantity: Number(raw.quantity ?? 0),
    quantity_unit: raw.quantity_unit ?? raw.quantityUnit ?? "units",
    total_value: Number(raw.total_value ?? raw.totalValue ?? 0),
    funded_amount: Number(
      raw.funded_amount ?? raw.total_invested ?? raw.totalInvested ?? 0,
    ),
    total_invested: Number(raw.total_invested ?? raw.totalInvested ?? 0),
    token_count: Number(raw.token_count ?? raw.tokenCount ?? 0),
    tokens_remaining: Number(raw.tokens_remaining ?? raw.tokensRemaining ?? 0),
    token_symbol: raw.token_symbol ?? raw.tokenSymbol ?? "",
    issuer_public_key: raw.issuer_public_key ?? raw.issuerPublicKey ?? null,
    status: raw.status ?? "draft",
    delivery_date: raw.delivery_date ?? raw.deliveryDate ?? "",
    annual_roi: raw.annual_roi ?? raw.annualRoi ?? 0.15, // Default 15%
    term_days: raw.term_days ?? raw.termDays ?? 90, // Default 90 days
    expected_roi: raw.expected_roi ?? raw.expectedRoi ?? null,
    duration_days: raw.duration_days ?? raw.durationDays ?? null,
    risk_rating: raw.risk_rating ?? raw.riskRating ?? null,
    created_at: raw.created_at ?? raw.createdAt ?? "",
    documents: raw.documents,
    milestones: raw.milestones,
    cover_image_url: raw.cover_image_url ?? raw.coverImageUrl ?? null,
    esg_score:
      raw.esg_score != null
        ? Number(raw.esg_score)
        : raw.esgScore != null
        ? Number(raw.esgScore)
        : null,
    environmental_score:
      raw.environmental_score != null
        ? Number(raw.environmental_score)
        : raw.environmentalScore != null
        ? Number(raw.environmentalScore)
        : null,
    social_score:
      raw.social_score != null
        ? Number(raw.social_score)
        : raw.socialScore != null
        ? Number(raw.socialScore)
        : null,
    governance_score:
      raw.governance_score != null
        ? Number(raw.governance_score)
        : raw.governanceScore != null
        ? Number(raw.governanceScore)
        : null,
    esg_rating: raw.esg_rating ?? raw.esgRating ?? null,
    esg_status: raw.esg_status ?? raw.esgStatus ?? null,
    esg_breakdown: raw.esg_breakdown ?? raw.esgBreakdown ?? null,
  };
}

// ── Auth-aware fetch helper ───────────────────────────────────────────────────

export function getStoredToken(): string | null {
  return getAuthToken();
}

function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const versionedPath = path.startsWith('/v1') || path.startsWith('/v2')
    ? path
    : `${API_VERSION}${path}`;
  const res = await fetch(`${API_BASE}${versionedPath}`, {
    ...init,
    credentials: "include",
    headers: traceHeaders({
      ...(typeof FormData !== "undefined" && init.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...authHeaders(),
      ...((init.headers as Record<string, string>) ?? {}),
    }),
    cache: "no-store",
  });
  captureTraceId(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err: any = new Error(body?.message ?? res.statusText);
    err.response = { status: res.status, data: body };
    throw err;
  }
  return res.json();
}

async function apiBlob(path: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? res.statusText);
  }
  return res.blob();
}

// ── Stateful API client (used by dashboard / login pages) ────────────────────

export interface ChatParticipant {
  userId: string;
  email?: string;
  role?: User["role"];
  lastReadAt?: string | null;
  self?: boolean;
}

export interface ChatAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderEmail?: string;
  content: string;
  replyToId: string | null;
  replyTo: { id: string; content: string; senderEmail?: string } | null;
  reactions: Record<string, string[]>;
  createdAt: string;
  readBy: string[];
  attachments: ChatAttachment[];
}

export interface ChatConversation {
  id: string;
  kind: "direct" | "group";
  name: string | null;
  dealId: string | null;
  createdAt: string;
  participants: ChatParticipant[];
  lastMessage?: ChatMessage | null;
  unreadCount?: number;
}

export interface ChatAnalytics {
  periodDays: number;
  conversationCount: number;
  sent: number;
  received: number;
  dailyActivity: Array<{ day: string; sent: number; received: number }>;
}

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
    setAuthToken(accessToken);
    return accessToken;
  },

  /** Fetch the authenticated user's profile from GET /users/me. */
  async getMe(): Promise<User> {
    const user = await apiFetch<User>("/users/me");
    localStorage.setItem("auth_user", JSON.stringify(user));
    return user;
  },

  setAuth(token: string, user: User) {
    setAuthToken(token);
    localStorage.setItem("auth_user", JSON.stringify(user));
  },

  clearAuth() {
    clearAuthToken();
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

  // POST /trade-deals — farmer self-listing
  async createDeal(data: {
    commodity: string;
    quantity: number;
    quantity_unit: "kg" | "tons";
    total_value: number;
    delivery_date: string;
  }): Promise<Deal> {
    const raw = await apiFetch<any>("/trade-deals", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return normalizeDeal(raw);
  },

  // GET /users/me/deals
  async getTraderDeals(): Promise<Deal[]> {
    return apiFetch<Deal[]>("/users/me/deals?role=trader");
  },

  // PATCH /investments/:id/cancel
  async cancelInvestment(investmentId: string, reason?: string): Promise<Investment> {
    return apiFetch<Investment>(`/investments/${investmentId}/cancel`, {
      method: "PATCH",
      body: JSON.stringify(reason ? { reason } : {}),
    });
  },

  // GET /investments/my-investments
  async getInvestorInvestments(): Promise<Investment[]> {
    const response = await apiFetch<Investment[] | PaginatedResponse<any>>(
      "/investments/my-investments",
    );
    return unwrapPaginated(response).map(normalizeInvestment);
  },

  // GET /investments/summary — portfolio totals and per-deal allocation (#789)
  async getPortfolioSummary(): Promise<PortfolioSummary> {
    return apiFetch<PortfolioSummary>("/investments/summary");
  },

  // POST /shipments/milestones  — trade_deal_id + milestone + notes in body
  async recordMilestone(
    dealId: string,
    data: {
      milestone: "farm" | "warehouse" | "port" | "importer";
      notes?: string;
    },
  ) {
    const body = { trade_deal_id: dealId, ...data };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      await enqueueOfflineOperation({
        resourceKey: `shipment-milestone:${dealId}:${data.milestone}`,
        type: 'shipment-milestone',
        method: 'POST',
        endpoint: `${API_BASE}${API_VERSION}/shipments/milestones`,
        body,
      });
      await registerBackgroundSync();
      return {
        queued: true,
        optimistic: true,
        trade_deal_id: dealId,
        ...data,
        recorded_at: new Date().toISOString(),
      };
    }

    return apiFetch("/shipments/milestones", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  // POST /auth/kyc
  async submitKyc(data: {
    fullName?: string;
    dateOfBirth?: string;
    nationality?: string;
    address?: string;
    governmentIdUrl?: string;
    identityDocumentBackUrl?: string;
    proofOfAddressUrl?: string;
    selfieUrl?: string;
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

  // GET /users/me/credit-score — Farmer Credit Score Disclosure (#1016)
  async getCreditScore(): Promise<CreditScoreDisclosure> {
    return apiFetch("/users/me/credit-score");
  },

  // GET /credit-scoring/me/history — monthly credit score evolution (#1160)
  async getCreditScoreHistory(months = 12): Promise<CreditScoreHistoryPoint[]> {
    return apiFetch(`/credit-scoring/me/history?months=${months}`);
  },

  // GET /credit-scoring/me/benchmark — regional peer comparison (#1160)
  async getCreditScoreBenchmark(): Promise<CreditScoreBenchmark> {
    return apiFetch("/credit-scoring/me/benchmark");
  },

  // GET /credit-scoring/me/disputes — the farmer's disputes (#1160)
  async getCreditScoreDisputes(): Promise<CreditScoreDispute[]> {
    return apiFetch("/credit-scoring/me/disputes");
  },

  // POST /credit-scoring/me/disputes — file a dispute (#1160)
  async fileCreditScoreDispute(input: {
    reason: string;
    factor?: string;
  }): Promise<CreditScoreDispute> {
    return apiFetch("/credit-scoring/me/disputes", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  // GET /credit-scoring/investment-recommendations — credit-ranked deals (#1160)
  async getCreditInvestmentRecommendations(
    minTier?: CreditScoreTier,
    limit = 10,
  ): Promise<{
    minTier: CreditScoreTier;
    count: number;
    recommendations: CreditInvestmentRecommendation[];
  }> {
    const tier = minTier ? `&minTier=${encodeURIComponent(minTier)}` : "";
    return apiFetch(
      `/credit-scoring/investment-recommendations?limit=${limit}${tier}`,
    );
  },

  // POST /trade-deals/:id/esg-questionnaire — ESG impact scoring (#1012)
  async submitEsgQuestionnaire(dealId: string, data: any): Promise<Deal> {
    return apiFetch(`/trade-deals/${dealId}/esg-questionnaire`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  // GET /trade-deals/:id/esg-score
  async getDealEsgScore(dealId: string): Promise<any> {
    return apiFetch(`/trade-deals/${dealId}/esg-score`);
  },

  getChatConversations(): Promise<ChatConversation[]> {
    return apiFetch("/chat/conversations");
  },

  createChatConversation(input: {
    participantIds: string[];
    name?: string;
    dealId?: string;
  }): Promise<ChatConversation> {
    return apiFetch("/chat/conversations", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  searchChatContacts(query: string): Promise<Array<Pick<User, "id" | "email" | "role">>> {
    return apiFetch(`/chat/contacts?q=${encodeURIComponent(query)}`);
  },

  getChatMessages(conversationId: string): Promise<ChatMessage[]> {
    return apiFetch(`/chat/conversations/${encodeURIComponent(conversationId)}/messages`);
  },

  searchChatMessages(conversationId: string, query: string): Promise<ChatMessage[]> {
    return apiFetch(
      `/chat/conversations/${encodeURIComponent(conversationId)}/search?q=${encodeURIComponent(query)}`,
    );
  },

  sendChatMessage(
    conversationId: string,
    content: string,
    replyToId?: string,
  ): Promise<ChatMessage> {
    return apiFetch(`/chat/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, replyToId }),
    });
  },

  markChatRead(conversationId: string): Promise<{ lastReadAt: string }> {
    return apiFetch(`/chat/conversations/${encodeURIComponent(conversationId)}/read`, {
      method: "POST",
      body: "{}",
    });
  },

  reactToChatMessage(messageId: string, emoji: string): Promise<ChatMessage> {
    return apiFetch(`/chat/messages/${encodeURIComponent(messageId)}/reactions`, {
      method: "POST",
      body: JSON.stringify({ emoji }),
    });
  },

  uploadChatAttachment(conversationId: string, file: File): Promise<ChatMessage> {
    const form = new FormData();
    form.append("file", file);
    return apiFetch(
      `/chat/conversations/${encodeURIComponent(conversationId)}/attachments`,
      { method: "POST", body: form },
    );
  },

  downloadChatAttachment(downloadUrl: string): Promise<Blob> {
    return apiBlob(downloadUrl);
  },

  getChatAnalytics(): Promise<ChatAnalytics> {
    return apiFetch("/chat/analytics");
  },

  // POST /auth/behavioral/risk — submit only the computed risk score and
  // anomaly flags. Raw behavioral data (keystroke/mouse/usage samples) never
  // leaves the device; only derived, non-reversible signals are sent.
  async submitBehavioralRisk(payload: {
    riskScore: number;
    anomalyFlags: string[];
    confidence?: number;
    sampledAt?: string;
  }): Promise<{ riskScore: number; action: "allow" | "challenge" | "block" }> {
    return apiFetch("/auth/behavioral/risk", {
      method: "POST",
      body: JSON.stringify({
        riskScore: payload.riskScore,
        anomalyFlags: payload.anomalyFlags,
        confidence: payload.confidence,
        sampledAt: payload.sampledAt ?? new Date().toISOString(),
      }),
    });
  },

  // GET /auth/behavioral/analytics — behavioral authentication accuracy and
  // false-positive metrics for the current user.
  async getBehavioralAnalytics(): Promise<BehavioralAnalytics> {
    return apiFetch("/auth/behavioral/analytics");
  },
};

export interface BehavioralAnalytics {
  periodDays: number;
  totalSamples: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  accuracy: number;
  falsePositiveRate: number;
  averageRiskScore: number;
  anomalyCount: number;
  challengesIssued: number;
  lastUpdated: string;
}

// ── Public marketplace helpers ────────────────────────────────────────────────

export interface PaginatedDeals {
  data: Deal[];
  total: number;
  page: number;
  limit: number;
}

export async function getOpenDeals(
  page = 1,
  limit = 12,
  sortBy?: string,
  sortOrder?: "ASC" | "DESC",
): Promise<PaginatedDeals> {
  let url = `/trade-deals?page=${page}&limit=${limit}`;
  if (sortBy) {
    url += `&sortBy=${sortBy}`;
  }
  if (sortOrder) {
    url += `&sortOrder=${sortOrder}`;
  }
  const raw = await apiFetch<{
    data: any[];
    total: number;
    page: number;
    limit: number;
  }>(url);
  return {
    data: raw.data.map(normalizeDeal),
    total: raw.total,
    page: raw.page,
    limit: raw.limit,
  };
}

export async function getDealById(id: string): Promise<Deal | null> {
  try {
    const raw = await apiFetch<any>(`/trade-deals/${id}`);
    return normalizeDeal(raw);
  } catch (err: any) {
    if (err?.response?.status === 404) return null;
    throw err;
  }
}
