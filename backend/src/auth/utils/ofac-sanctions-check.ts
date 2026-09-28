import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';

/**
 * Service to check Stellar addresses against OFAC sanctions lists.
 * Uses Chainalysis API or similar sanctions screening service.
 */
@Injectable()
export class OfacSanctionsCheckService {
  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor(private readonly configService: ConfigService) {
    this.apiUrl =
      this.configService.get<string>('OFAC_API_URL') ||
      'https://api.chainalysis.com/kyt/v1';
    this.apiKey = this.configService.get<string>('OFAC_API_KEY') || '';
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
      console.warn(
        'OFAC_API_KEY not configured. Skipping sanctions check. ' +
          'This should not happen in production.',
      );
      return false;
    }

    try {
      const response = await axios.get(
        `${this.apiUrl}/address/${walletAddress}/risk`,
        {
          headers: {
            'X-API-KEY': this.apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 10000, // 10 second timeout
        },
      );

      // Chainalysis API response structure:
      // { address: string, riskScore: number, assessments: [...] }
      // We consider an address sanctioned if it has a high risk score or specific sanctions flags
      const riskData = response.data;

      // Check if the address is flagged as sanctioned
      if (riskData.assessments && Array.isArray(riskData.assessments)) {
        const hasSanctionsFlag = riskData.assessments.some(
          (assessment: any) =>
            assessment.category === 'sanctions' ||
            assessment.category === 'ofac' ||
            assessment.category === 'blocked',
        );

        if (hasSanctionsFlag) {
          console.warn(
            `Address ${walletAddress} is flagged for sanctions:`,
            JSON.stringify(riskData.assessments),
          );
          return true;
        }
      }

      // Alternative check: high risk score (threshold configurable)
      const riskThreshold =
        this.configService.get<number>('OFAC_RISK_THRESHOLD') || 80;
      if (riskData.riskScore && riskData.riskScore >= riskThreshold) {
        console.warn(
          `Address ${walletAddress} has high risk score: ${riskData.riskScore}`,
        );
        return true;
      }

      return false;
    } catch (error) {
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
          console.error('OFAC API authentication failed:', axiosError.message);
          // In production, you might want to fail closed and reject the address
          // For now, we'll throw an error
          throw new BadRequestException({
            code: 'SANCTIONS_CHECK_FAILED',
            message:
              'Unable to verify address sanctions status due to API authentication error',
          });
        }

        // For other API errors, log and fail closed in production
        console.error('OFAC API error:', axiosError.message);
        if (this.configService.get<string>('NODE_ENV') === 'production') {
          throw new BadRequestException({
            code: 'SANCTIONS_CHECK_FAILED',
            message: 'Unable to verify address sanctions status',
          });
        }

        // In development, allow the operation but log a warning
        console.warn(
          'OFAC check failed in development mode. Allowing operation.',
        );
        return false;
      }

      // Non-Axios errors
      console.error('Unexpected error during OFAC check:', error);
      throw new BadRequestException({
        code: 'SANCTIONS_CHECK_FAILED',
        message: 'Unable to verify address sanctions status',
      });
    }
  }
}
