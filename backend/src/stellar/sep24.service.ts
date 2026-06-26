import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { randomBytes } from 'crypto';
import {
  Sep24Transaction,
  Sep24TxKind,
  Sep24TxStatus,
} from './entities/sep24-transaction.entity';

export interface Sep24InfoResponse {
  deposit: Record<string, Sep24AssetInfo>;
  withdraw: Record<string, Sep24AssetInfo>;
  fee: { enabled: boolean };
  features: {
    account_creation: boolean;
    claimable_balances: boolean;
  };
}

export interface Sep24AssetInfo {
  enabled: boolean;
  fee_fixed: number;
  fee_percent: number;
  min_amount: number;
  max_amount: number;
}

export interface Sep24InteractiveRequest {
  asset_code: string;
  account: string;
  amount?: string;
  dest?: string;
  dest_extra?: string;
}

export interface Sep24InteractiveResponse {
  id: string;
  url: string;
  type: 'interactive_customer_info_needed';
}

export interface Sep24TransactionResponse {
  transaction: {
    id: string;
    kind: Sep24TxKind;
    status: Sep24TxStatus;
    amount_in?: string;
    amount_out?: string;
    amount_fee?: string;
    started_at: string;
    completed_at?: string;
    stellar_transaction_id?: string;
    external_transaction_id?: string;
    message?: string;
    more_info_url?: string;
  };
}

export interface Sep24CallbackPayload {
  transaction_id: string;
  status: Sep24TxStatus;
  message?: string;
  amount_in?: string;
  amount_out?: string;
  external_transaction_id?: string;
  stellar_transaction_id?: string;
}

const TERMINAL_STATUSES = new Set<Sep24TxStatus>([
  Sep24TxStatus.COMPLETED,
  Sep24TxStatus.ERROR,
  Sep24TxStatus.REFUNDED,
  Sep24TxStatus.EXPIRED,
]);

@Injectable()
export class Sep24Service {
  private readonly usdcIssuer: string;
  private readonly supportedAsset: string;
  private readonly interactiveBaseUrl: string;
  private readonly feePercent: number;
  private readonly feeFixed: number;

  constructor(
    @InjectRepository(Sep24Transaction)
    private readonly txRepo: Repository<Sep24Transaction>,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(Sep24Service.name);
    this.usdcIssuer = this.config.get<string>(
      'USDC_ISSUER',
      'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    );
    this.supportedAsset = this.config.get<string>('USDC_ASSET_CODE', 'USDC');
    this.interactiveBaseUrl = this.config.get<string>(
      'SEP24_INTERACTIVE_BASE_URL',
      'http://localhost:3000/sep24/interactive',
    );
    this.feePercent = this.config.get<number>('SEP24_FEE_PERCENT', 1);
    this.feeFixed = this.config.get<number>('SEP24_FEE_FIXED', 0);
  }

  getInfo(): Sep24InfoResponse {
    const assetInfo: Sep24AssetInfo = {
      enabled: true,
      fee_fixed: this.feeFixed,
      fee_percent: this.feePercent,
      min_amount: this.config.get<number>('SEP24_MIN_AMOUNT', 10),
      max_amount: this.config.get<number>('SEP24_MAX_AMOUNT', 100_000),
    };

    return {
      deposit: { [this.supportedAsset]: assetInfo },
      withdraw: { [this.supportedAsset]: assetInfo },
      fee: { enabled: true },
      features: {
        account_creation: false,
        claimable_balances: false,
      },
    };
  }

  async initiateDepositInteractive(
    req: Sep24InteractiveRequest,
    userId: string | null,
  ): Promise<Sep24InteractiveResponse> {
    this.validateInteractiveRequest(req, Sep24TxKind.DEPOSIT);

    const id = this.generateTransactionId();
    const tx = this.txRepo.create({
      id,
      stellarAccount: req.account,
      userId,
      kind: Sep24TxKind.DEPOSIT,
      assetCode: req.asset_code,
      amountIn: req.amount ?? null,
      status: Sep24TxStatus.PENDING_ANCHOR,
      message: 'Complete verification in the interactive window.',
    });

    await this.txRepo.save(tx);

    const url = `${this.interactiveBaseUrl}?transaction_id=${id}&kind=deposit`;

    this.logger.info({ id, account: req.account }, 'SEP-24 deposit initiated');

    return {
      id,
      url,
      type: 'interactive_customer_info_needed',
    };
  }

  async initiateWithdrawInteractive(
    req: Sep24InteractiveRequest,
    userId: string | null,
  ): Promise<Sep24InteractiveResponse> {
    this.validateInteractiveRequest(req, Sep24TxKind.WITHDRAW);

    const id = this.generateTransactionId();
    const tx = this.txRepo.create({
      id,
      stellarAccount: req.account,
      userId,
      kind: Sep24TxKind.WITHDRAW,
      assetCode: req.asset_code,
      amountIn: req.amount ?? null,
      dest: req.dest ?? null,
      destExtra: req.dest_extra ?? null,
      status: Sep24TxStatus.PENDING_ANCHOR,
      message: 'Complete verification in the interactive window.',
    });

    await this.txRepo.save(tx);

    const url = `${this.interactiveBaseUrl}?transaction_id=${id}&kind=withdraw`;

    this.logger.info({ id, account: req.account }, 'SEP-24 withdrawal initiated');

    return {
      id,
      url,
      type: 'interactive_customer_info_needed',
    };
  }

  async getTransaction(
    id: string,
    stellarAccount: string,
  ): Promise<Sep24TransactionResponse> {
    const tx = await this.findOwnedTransaction(id, stellarAccount);
    return { transaction: this.toTransactionDto(tx) };
  }

  async listTransactions(
    kind: Sep24TxKind,
    stellarAccount: string,
  ): Promise<{ transactions: Sep24TransactionResponse['transaction'][] }> {
    const txs = await this.txRepo.find({
      where: { kind, stellarAccount },
      order: { startedAt: 'DESC' },
    });

    return { transactions: txs.map((tx) => this.toTransactionDto(tx)) };
  }

  async handleStatusCallback(payload: Sep24CallbackPayload): Promise<void> {
    const { transaction_id, status } = payload;

    if (!transaction_id || !status) {
      throw new BadRequestException(
        'transaction_id and status are required in callback payload.',
      );
    }

    if (!Object.values(Sep24TxStatus).includes(status)) {
      throw new BadRequestException(`Invalid status: ${status}`);
    }

    const tx = await this.txRepo.findOne({ where: { id: transaction_id } });
    if (!tx) {
      throw new NotFoundException(
        `SEP-24 transaction ${transaction_id} not found.`,
      );
    }

    if (TERMINAL_STATUSES.has(tx.status)) {
      this.logger.warn(
        { id: transaction_id, currentStatus: tx.status, newStatus: status },
        'Ignoring callback for terminal transaction',
      );
      return;
    }

    tx.status = status;
    if (payload.message) tx.message = payload.message;
    if (payload.amount_in) tx.amountIn = payload.amount_in;
    if (payload.amount_out) tx.amountOut = payload.amount_out;
    if (payload.external_transaction_id) {
      tx.externalTxId = payload.external_transaction_id;
    }
    if (payload.stellar_transaction_id) {
      tx.stellarTransactionId = payload.stellar_transaction_id;
    }

    await this.txRepo.save(tx);

    this.logger.info(
      { id: transaction_id, status },
      'SEP-24 transaction status updated via callback',
    );
  }

  assertAccountMatchesWallet(
    account: string,
    walletAddress: string | null,
  ): void {
    if (!walletAddress) {
      throw new ForbiddenException(
        'No wallet address linked to your account.',
      );
    }
    if (account !== walletAddress) {
      throw new ForbiddenException(
        'Account must match your linked Stellar wallet.',
      );
    }
  }

  private validateInteractiveRequest(
    req: Sep24InteractiveRequest,
    kind: Sep24TxKind,
  ): void {
    if (!req.asset_code || !req.account) {
      throw new BadRequestException('asset_code and account are required.');
    }

    if (!req.account.startsWith('G')) {
      throw new BadRequestException('account must be a valid Stellar public key.');
    }

    if (req.asset_code !== this.supportedAsset) {
      throw new BadRequestException(
        `Unsupported asset_code. Only ${this.supportedAsset} is supported.`,
      );
    }

    if (req.amount) {
      const amount = parseFloat(req.amount);
      const min = this.config.get<number>('SEP24_MIN_AMOUNT', 10);
      const max = this.config.get<number>('SEP24_MAX_AMOUNT', 100_000);
      if (Number.isNaN(amount) || amount <= 0) {
        throw new BadRequestException('amount must be a positive number.');
      }
      if (amount < min || amount > max) {
        throw new BadRequestException(
          `amount must be between ${min} and ${max}.`,
        );
      }
    }

    if (kind === Sep24TxKind.WITHDRAW && req.dest && req.dest.length > 256) {
      throw new BadRequestException('dest exceeds maximum length.');
    }
  }

  private async findOwnedTransaction(
    id: string,
    stellarAccount: string,
  ): Promise<Sep24Transaction> {
    const tx = await this.txRepo.findOne({ where: { id } });
    if (!tx) {
      throw new NotFoundException(`Transaction ${id} not found.`);
    }
    if (tx.stellarAccount !== stellarAccount) {
      throw new ForbiddenException('Transaction does not belong to this account.');
    }
    return tx;
  }

  private toTransactionDto(
    tx: Sep24Transaction,
  ): Sep24TransactionResponse['transaction'] {
    const fee =
      tx.amountIn && this.feePercent > 0
        ? ((parseFloat(tx.amountIn) * this.feePercent) / 100).toFixed(7)
        : undefined;

    return {
      id: tx.id,
      kind: tx.kind,
      status: tx.status,
      ...(tx.amountIn && { amount_in: tx.amountIn }),
      ...(tx.amountOut && { amount_out: tx.amountOut }),
      ...(fee && { amount_fee: fee }),
      started_at: tx.startedAt.toISOString(),
      ...(TERMINAL_STATUSES.has(tx.status) && {
        completed_at: tx.updatedAt.toISOString(),
      }),
      ...(tx.stellarTransactionId && {
        stellar_transaction_id: tx.stellarTransactionId,
      }),
      ...(tx.externalTxId && {
        external_transaction_id: tx.externalTxId,
      }),
      ...(tx.message && { message: tx.message }),
      more_info_url: `${this.interactiveBaseUrl}?transaction_id=${tx.id}`,
    };
  }

  private generateTransactionId(): string {
    return randomBytes(16).toString('hex');
  }

  /** Exposed for tests and documentation of supported USDC issuer. */
  getUsdcIssuer(): string {
    return this.usdcIssuer;
  }
}
