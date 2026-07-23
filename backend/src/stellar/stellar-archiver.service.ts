import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Horizon, Keypair } from '@stellar/stellar-sdk';
import { StellarHistory } from './entities/stellar-history.entity';

@Injectable()
export class StellarArchiverService {
  private readonly logger = new Logger(StellarArchiverService.name);
  private readonly server: Horizon.Server;
  private readonly platformAccountId: string | null = null;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(StellarHistory)
    private readonly stellarHistoryRepo: Repository<StellarHistory>,
  ) {
    const horizonUrl = this.config.get<string>(
      'STELLAR_HORIZON_URL',
      'https://horizon-testnet.stellar.org',
    );
    this.server = new Horizon.Server(horizonUrl);

    const platformSecret = this.config.get<string>('STELLAR_PLATFORM_SECRET', '');
    if (platformSecret) {
      try {
        const keypair = Keypair.fromSecret(platformSecret);
        this.platformAccountId = keypair.publicKey();
      } catch (err) {
        this.logger.warn('Failed to parse STELLAR_PLATFORM_SECRET for archiver');
      }
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async archiveLedgerHistory() {
    this.logger.log('Starting ledger history archiving cycle...');

    if (!this.platformAccountId) {
      this.logger.warn('No platform account configured. Skipping archiving.');
      return;
    }

    try {
      // Find the latest cursor we have successfully stored
      const lastRecord = await this.stellarHistoryRepo.findOne({
        order: { ledgerCreatedAt: 'DESC' },
      });
      
      let cursor = lastRecord?.payload?.paging_token || '0';

      let hasMore = true;
      let pagesProcessed = 0;
      
      // Fetch up to 10 pages per cron run to avoid keeping the process busy for too long
      while (hasMore && pagesProcessed < 10) {
        const response = await this.server
          .transactions()
          .forAccount(this.platformAccountId)
          .cursor(cursor)
          .limit(200)
          .order('asc')
          .call();

        if (response.records.length === 0) {
          this.logger.log('No new transactions found. Caught up to current ledger.');
          break;
        }

        const newRecords: StellarHistory[] = [];
        for (const record of response.records) {
          const exists = await this.stellarHistoryRepo.findOne({ where: { txHash: record.hash } });
          if (!exists) {
            const history = this.stellarHistoryRepo.create({
              txHash: record.hash,
              ledger: record.ledger_attr,
              ledgerCreatedAt: new Date(record.created_at),
              payload: record,
            });
            newRecords.push(history);
          }
          cursor = record.paging_token;
        }

        if (newRecords.length > 0) {
          await this.stellarHistoryRepo.save(newRecords);
          this.logger.log(`Archived ${newRecords.length} new transactions.`);
        }

        pagesProcessed++;
        
        // If we received fewer than 200 records, we've likely hit the end of the history
        if (response.records.length < 200) {
          hasMore = false;
        }
      }
    } catch (error: any) {
      this.logger.error('Error during ledger history archiving', error.stack);
    }
  }
}
