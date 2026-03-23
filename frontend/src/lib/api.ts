import axios from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface Deal {
  id: string;
  commodity: string;
  quantity: number;
  total_value: number;
  status: string;
  funded_amount: number;
  farmer_id: string;
  trader_id: string;
  created_at: string;
  updated_at: string;
  milestones?: Milestone[];
}

export interface Milestone {
  id: string;
  deal_id: string;
  title: string;
  description: string;
  status: string;
  completed_at?: string;
  created_at: string;
}

export interface Investment {
  id: string;
  deal_id: string;
  investor_id: string;
  amount_invested: number;
  token_holdings: number;
  deal: Deal;
  created_at: string;
}

export interface User {
  id: string;
  email: string;
  role: 'farmer' | 'trader' | 'investor';
  name?: string;
}

class ApiClient {
  private axiosInstance;

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor to include auth token
    this.axiosInstance.interceptors.request.use(
      (config) => {
        const token = this.getAuthToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Add response interceptor to handle auth errors
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          // Token expired or invalid - redirect to login
          if (typeof window !== 'undefined') {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('user');
            window.location.href = '/login';
          }
        }
        return Promise.reject(error);
      }
    );
  }

  private getAuthToken(): string | null {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('auth_token');
    }
    return null;
  }

  public getCurrentUser(): User | null {
    if (typeof window !== 'undefined') {
      const userStr = localStorage.getItem('user');
      return userStr ? JSON.parse(userStr) : null;
    }
    return null;
  }

  public setAuth(token: string, user: User): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem('auth_token', token);
      localStorage.setItem('user', JSON.stringify(user));
    }
  }

  public clearAuth(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user');
    }
  }

  // Dashboard API methods
  public async getFarmerDeals(): Promise<Deal[]> {
    const response = await this.axiosInstance.get<ApiResponse<Deal[]>>('/api/dashboard/farmer');
    return response.data.data;
  }

  public async getTraderDeals(): Promise<Deal[]> {
    const response = await this.axiosInstance.get<ApiResponse<Deal[]>>('/api/dashboard/trader');
    return response.data.data;
  }

  public async getInvestorInvestments(): Promise<Investment[]> {
    const response = await this.axiosInstance.get<ApiResponse<Investment[]>>('/api/dashboard/investor');
    return response.data.data;
  }

  public async recordMilestone(dealId: string, milestoneData: Partial<Milestone>): Promise<Milestone> {
    const response = await this.axiosInstance.post<ApiResponse<Milestone>>(
      `/api/deals/${dealId}/milestones`,
      milestoneData
    );
    return response.data.data;
  }

  // Generic API methods
  public async get<T>(url: string): Promise<T> {
    const response = await this.axiosInstance.get<ApiResponse<T>>(url);
    return response.data.data;
  }

  public async post<T>(url: string, data?: any): Promise<T> {
    const response = await this.axiosInstance.post<ApiResponse<T>>(url, data);
    return response.data.data;
  }

  public async put<T>(url: string, data?: any): Promise<T> {
    const response = await this.axiosInstance.put<ApiResponse<T>>(url, data);
    return response.data.data;
  }

  public async delete<T>(url: string): Promise<T> {
    const response = await this.axiosInstance.delete<ApiResponse<T>>(url);
    return response.data.data;
  }
}

export const apiClient = new ApiClient();
export default apiClient;
