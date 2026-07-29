import {
  Injectable,
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import type CircuitBreaker from 'opossum';
import {
  CircuitBreakerFactory,
  isCircuitOpenError,
} from '../../common/circuit-breaker';

interface OfacRiskResponse {
  address?: string;
  riskScore?: number;
  assessments?: Array<{ category?: string }>;
}

/**
 * Service to check Stellar addresses against OFAC sanctions lists.
 * Uses Chainalysis API or similar sanctions screening service.
 * Outbound calls are protected by an opossum circuit breaker.
 */
@Injectable()
export class OfacSanctionsCheckService {
  private readonly logger = new Logger(OfacSanctionsCheckService.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly ofacBreaker: CircuitBreaker<[string], OfacRiskResponse>;

  constructor(
    private readonly configService: ConfigService,
    private readonly circuitBreakers: CircuitBreakerFactory,
  ) {
    this.apiUrl =
      this.configService.get<string>('OFAC_API_URL') ||
      'https://api.chainalysis.com/kyt/v1';
    this.apiKey = this.configService.get<string>('OFAC_API_KEY') || '';

    this.ofacBreaker = this.circuitBreakers.create(
      'kyc-ofac',
      (walletAddress: string) => this.fetchRisk(walletAddress),
      {
        timeout: 10_000,
        resetTimeout: 30_000,
        volumeThreshold: 5,
        errorThresholdPercentage: 50,
        // 404 = address not in list — not a provider outage
        errorFilter: (error) =>
          axios.isAxiosError(error) && error.response?.status === 404,
      },
    );
  }

  /**
   * Checks if a Stellar address is sanctioned.
   *
   * @param walletAddress - The Stellar wallet address to check
   * @returns Promise<boolean> - true if the address is sanctioned (blocked), false if safe
   * @throws BadRequestException if the API call fails or returns an error
   */
  async isAddressSanctioned(walletAddress: string): Promise<boolean> {
    if (!this.apiKey) {
      // If no API key is configured, log a warning but allow the operation
      // This is a safety fallback for development environments
      this.logger.warn(
        'OFAC_API_KEY not configured. Skipping sanctions check. ' +
          'This should not happen in production.',
      );
      return false;
    }

    try {
      const riskData = await this.ofacBreaker.fire(walletAddress);

      // Chainalysis API response structure:
      // { address: string, riskScore: number, assessments: [...] }
      // We consider an address sanctioned if it has a high risk score or specific sanctions flags
      if (riskData.assessments && Array.isArray(riskData.assessments)) {
        const hasSanctionsFlag = riskData.assessments.some(
          (assessment) =>
            assessment.category === 'sanctions' ||
            assessment.category === 'ofac' ||
            assessment.category === 'blocked',
        );

        if (hasSanctionsFlag) {
          this.logger.warn(
            `Address ${walletAddress} is flagged for sanctions: ${JSON.stringify(riskData.assessments)}`,
          );
          return true;
        }
      }

      // Alternative check: high risk score (threshold configurable)
      const riskThreshold =
        this.configService.get<number>('OFAC_RISK_THRESHOLD') || 80;
      if (riskData.riskScore && riskData.riskScore >= riskThreshold) {
        this.logger.warn(
          `Address ${walletAddress} has high risk score: ${riskData.riskScore}`,
        );
        return true;
      }

      return false;
    } catch (error) {
      if (isCircuitOpenError(error)) {
        this.logger.error(
          'OFAC circuit breaker is open — failing fast without calling provider',
        );
        throw new ServiceUnavailableException({
          code: 'SANCTIONS_CHECK_UNAVAILABLE',
          message:
            'Sanctions screening temporarily unavailable (circuit open). Try again later.',
        });
      }

      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;

        // If the API returns 404, the address is not found in sanctions lists
        if (axiosError.response?.status === 404) {
          return false;
        }

        // If the API returns 401/403, there's an authentication issue
        if (
          axiosError.response?.status === 401 ||
          axiosError.response?.status === 403
        ) {
          this.logger.error(
            `OFAC API authentication failed: ${axiosError.message}`,
          );
          throw new BadRequestException({
            code: 'SANCTIONS_CHECK_FAILED',
            message:
              'Unable to verify address sanctions status due to API authentication error',
          });
        }

        // For other API errors, log and fail closed in production
        this.logger.error(`OFAC API error: ${axiosError.message}`);
        if (this.configService.get<string>('NODE_ENV') === 'production') {
          throw new BadRequestException({
            code: 'SANCTIONS_CHECK_FAILED',
            message: 'Unable to verify address sanctions status',
          });
        }

        // In development, allow the operation but log a warning
        this.logger.warn(
          'OFAC check failed in development mode. Allowing operation.',
        );
        return false;
      }

      // Non-Axios errors
      this.logger.error(`Unexpected error during OFAC check: ${String(error)}`);
      throw new BadRequestException({
        code: 'SANCTIONS_CHECK_FAILED',
        message: 'Unable to verify address sanctions status',
      });
    }
  }

  getCircuitState(): {
    opened: boolean;
    halfOpen: boolean;
    closed: boolean;
  } {
    return {
      opened: this.ofacBreaker.opened,
      halfOpen: this.ofacBreaker.halfOpen,
      closed: this.ofacBreaker.closed,
    };
  }

  private async fetchRisk(walletAddress: string): Promise<OfacRiskResponse> {
    const response = await axios.get(
      `${this.apiUrl}/address/${walletAddress}/risk`,
      {
        headers: {
          'X-API-KEY': this.apiKey,
          'Content-Type': 'application/json',
        },
        timeout: 10_000,
      },
    );
    return response.data as OfacRiskResponse;
  }
}
