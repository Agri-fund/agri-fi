/**
 * SorobanRentService (#698)
 *
 * Manages Soroban contract rent / state-expiration to prevent escrow payouts
 * from failing when contract storage entries expire and become ARCHIVED.
 *
 * Responsibilities:
 *  1. Scheduled job (every 6 hours) — extends the TTL of all active campaign
 *     contracts by calling extend_footprint_ttl so they never expire.
 *  2. Archived-state recovery — when a contract is detected as archived,
 *     issue restore_footprint + immediate TTL extension to bring it back.
 *  3. Expiry-warning check — logs a warning when a contract's remaining TTL
 *     drops below the configured threshold (default: 3 days).
 *
 * The service runs only when SOROBAN_RPC_URL is configured, so it is a no-op
 * in local development environments that have no Soroban RPC endpoint.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { SorobanService } from './soroban.service';

/** Minimum remaining ledgers before a TTL-extension warning is logged. */
const DEFAULT_WARN_TTL_LEDGERS = 86_400; // ~5 days at 5 s/ledger
/** Target TTL after a rent-bump: ~30 days at 5 s/ledger on testnet. */
const DEFAULT_EXTEND_TO_LEDGERS = 535_680;

@Injectable()
export class SorobanRentService implements OnModuleInit {
  private readonly logger = new Logger(SorobanRentService.name);
  private readonly rpcUrl: string;
  /** Contract IDs that are known to be currently archived (pending restore). */
  private readonly archivedContracts = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    private readonly soroban: SorobanService,
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
  ) {
    this.rpcUrl = this.config.get<string>('SOROBAN_RPC_URL', '');
  }

  onModuleInit(): void {
    if (!this.rpcUrl) {
      this.logger.warn(
        'SOROBAN_RPC_URL is not configured — Soroban rent management is disabled.',
      );
    } else {
      this.logger.log(
        `SorobanRentService initialized. RPC: ${this.rpcUrl}`,
      );
    }
  }

  // ── Scheduled Jobs ──────────────────────────────────────────────────────────

  /**
   * Primary rent-bump job — runs every 6 hours.
   *
   * For every active trade deal that has a Soroban campaign contract:
   *   1. Fetch the contract's current TTL from the ledger.
   *   2. If TTL < warn threshold, log a warning.
   *   3. If TTL < extend threshold (or contract is archived), extend / restore.
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async extendAllContractTtls(): Promise<void> {
    if (!this.rpcUrl) return;

    this.logger.log('Starting scheduled Soroban contract TTL extension run…');

    const contractIds = await this.fetchActiveContractIds();
    if (contractIds.length === 0) {
      this.logger.log('No active Soroban contracts found — skipping rent bump.');
      return;
    }

    this.logger.log(
      `Found ${contractIds.length} active contract(s) to check.`,
    );

    let extended = 0;
    let failed = 0;

    for (const contractId of contractIds) {
      try {
        await this.processContract(contractId);
        extended++;
      } catch (err: any) {
        failed++;
        this.logger.error(
          `Failed to extend TTL for contract ${contractId}: ${err.message}`,
        );
      }
    }

    this.logger.log(
      `TTL extension run complete. Extended: ${extended}, Failed: ${failed}.`,
    );
  }

  /**
   * Archived-state recovery job — runs every 30 minutes.
   *
   * Checks contracts that were previously flagged as archived and attempts
   * to restore them. This provides a faster recovery path than waiting for
   * the 6-hour full-scan job.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async recoverArchivedContracts(): Promise<void> {
    if (!this.rpcUrl || this.archivedContracts.size === 0) return;

    this.logger.log(
      `Attempting recovery for ${this.archivedContracts.size} archived contract(s)…`,
    );

    for (const contractId of [...this.archivedContracts]) {
      try {
        await this.restoreAndExtend(contractId);
        this.archivedContracts.delete(contractId);
        this.logger.log(`Successfully restored archived contract ${contractId}.`);
      } catch (err: any) {
        this.logger.error(
          `Recovery failed for archived contract ${contractId}: ${err.message}`,
        );
      }
    }
  }

  // ── Public API (callable from other services / admin endpoints) ─────────────

  /**
   * Manually trigger a rent-bump for a single contract.
   * Called by the SorobanController or admin endpoints when a contract
   * is flagged as near-expiry from an external monitor.
   */
  async bumpContractRent(contractId: string): Promise<string> {
    return this.soroban.extendContractTtl(contractId, DEFAULT_EXTEND_TO_LEDGERS);
  }

  /**
   * Manually restore an archived contract and re-extend its TTL.
   * Called when the platform detects that escrow payouts are failing
   * due to an archived contract state.
   */
  async recoverContract(contractId: string): Promise<{ restoreHash: string; extendHash: string }> {
    return this.restoreAndExtend(contractId);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async processContract(contractId: string): Promise<void> {
    const ttl = await this.soroban.getContractTtl(contractId);

    if (ttl === null) {
      // TTL query returned nothing — contract is likely archived
      this.logger.warn(
        `Contract ${contractId} TTL is null — may be ARCHIVED. Attempting restore…`,
      );
      this.archivedContracts.add(contractId);
      await this.restoreAndExtend(contractId);
      this.archivedContracts.delete(contractId);
      return;
    }

    this.logger.debug(
      `Contract ${contractId} has ${ttl} ledgers remaining (~${this.ledgersToHours(ttl)}h).`,
    );

    if (ttl < DEFAULT_WARN_TTL_LEDGERS) {
      this.logger.warn(
        `Contract ${contractId} TTL is LOW: ${ttl} ledgers (~${this.ledgersToHours(ttl)}h). Extending…`,
      );
    }

    // Always extend to keep the contract well ahead of expiry
    const hash = await this.soroban.extendContractTtl(
      contractId,
      DEFAULT_EXTEND_TO_LEDGERS,
    );
    this.logger.log(
      `Extended TTL for ${contractId} → ${DEFAULT_EXTEND_TO_LEDGERS} ledgers. tx: ${hash}`,
    );
  }

  private async restoreAndExtend(
    contractId: string,
  ): Promise<{ restoreHash: string; extendHash: string }> {
    const restoreHash = await this.soroban.restoreArchivedContract(contractId);
    this.logger.log(`Restored archived contract ${contractId}. tx: ${restoreHash}`);

    const extendHash = await this.soroban.extendContractTtl(
      contractId,
      DEFAULT_EXTEND_TO_LEDGERS,
    );
    this.logger.log(
      `Extended TTL after restore for ${contractId}. tx: ${extendHash}`,
    );

    return { restoreHash, extendHash };
  }

  /**
   * Fetches all Soroban campaign contract IDs from active trade deals.
   * Also includes the factory and settlement contract IDs from configuration,
   * since those are shared across all deals and must never expire.
   */
  private async fetchActiveContractIds(): Promise<string[]> {
    const deals = await this.tradeDealRepo.find({
      where: {
        sorobanCampaignContractId: Not(IsNull()),
        status: Not('completed' as any),
      },
      select: ['sorobanCampaignContractId'],
    });

    const campaignIds = deals
      .map((d) => d.sorobanCampaignContractId)
      .filter((id): id is string => Boolean(id));

    // Always include the global platform contracts
    const platformContracts = [
      this.config.get<string>('SOROBAN_FACTORY_CONTRACT_ID'),
      this.config.get<string>('SOROBAN_SETTLEMENT_CONTRACT_ID'),
      this.config.get<string>('SOROBAN_DISTRIBUTOR_CONTRACT_ID'),
    ].filter((id): id is string => Boolean(id));

    return [...new Set([...campaignIds, ...platformContracts])];
  }

  private ledgersToHours(ledgers: number): number {
    // Testnet: ~5 seconds per ledger
    return Math.round((ledgers * 5) / 3600);
  }
}
