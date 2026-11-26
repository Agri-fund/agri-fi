import { Horizon } from '@stellar/stellar-sdk';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../src/database/data-source';
import { TradeDeal } from '../src/trade-deals/entities/trade-deal.entity';
import { Investment } from '../src/investments/entities/investment.entity';
import { PaymentDistribution } from '../src/escrow/entities/payment-distribution.entity';
import { StellarService } from '../src/stellar/stellar.service';

const STROOPS_PER_UNIT = BigInt(10_000_000);

export interface EscrowReconciliationResult {
  tradeDealId: string;
  reconciled: boolean;
  insertedCount: number;
  dealStatus: string;
  stellarTxId?: string;
  error?: string;
}

/**
 * Reconciles an escrow deal where on-chain Stellar transaction succeeded
 * but database PaymentDistribution rows or status update failed (#1306).
 */
export async function reconcileEscrowDeal(
  dataSource: DataSource,
  stellarService: StellarService,
  tradeDealId: string,
  stellarTxId?: string,
): Promise<EscrowReconciliationResult> {
  let txConfirmed = false;
  let verifiedTxId = stellarTxId;

  if (stellarTxId) {
    try {
      const statusRes = await stellarService.getTransactionStatus(stellarTxId);
      const statusStr =
        typeof statusRes === 'object' && statusRes !== null
          ? statusRes.status
          : statusRes;
      if (statusStr === 'success') {
        txConfirmed = true;
      }
    } catch (err: any) {
      // Best effort lookup
    }
  }

  const dealRepo = dataSource.getRepository(TradeDeal);
  const investmentRepo = dataSource.getRepository(Investment);
  const distributionRepo = dataSource.getRepository(PaymentDistribution);

  const deal = await dealRepo.findOne({
    where: { id: tradeDealId },
    relations: ['farmer'],
  });

  if (!deal) {
    throw new Error(`Trade deal ${tradeDealId} not found for escrow reconciliation`);
  }

  const investments = await investmentRepo.find({
    where: { tradeDealId },
    relations: ['investor'],
  });

  const existingDistributions = await distributionRepo.find({
    where: { tradeDealId },
  });

  const hasPlatform = existingDistributions.some(
    (d) => d.recipientType === 'platform',
  );
  const hasFarmer = existingDistributions.some(
    (d) => d.recipientType === 'farmer',
  );
  const existingInvestorUserIds = new Set(
    existingDistributions
      .filter((d) => d.recipientType === 'investor' && d.recipientId)
      .map((d) => d.recipientId),
  );

  const totalValue = Number(deal.totalValue);
  const totalCents = Math.round(totalValue * 100);
  const platformCents = Math.round(totalCents * 0.02);
  const investorPoolCents = totalCents - platformCents;
  const platformAmount = platformCents / 100;
  const farmerAmount = (totalCents * 0.98) / 100;

  const weights = investments.map((inv) => Number(inv.tokenAmount) || 0);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  const investorAmounts: number[] = [];
  if (weights.length > 0 && totalWeight > 0) {
    let allocatedCents = 0;
    for (let i = 0; i < weights.length; i++) {
      if (i === weights.length - 1) {
        investorAmounts.push((investorPoolCents - allocatedCents) / 100);
      } else {
        const shareCents = Math.floor((investorPoolCents * weights[i]) / totalWeight);
        allocatedCents += shareCents;
        investorAmounts.push(shareCents / 100);
      }
    }
  }

  const missingRows: PaymentDistribution[] = [];
  const txIdToRecord = verifiedTxId || deal.appTraceId || null;

  if (!hasPlatform) {
    missingRows.push(
      distributionRepo.create({
        tradeDealId,
        recipientType: 'platform',
        recipientId: null,
        walletAddress: process.env.STELLAR_PLATFORM_WALLET || 'PLATFORM_TREASURY',
        amountUsd: platformAmount,
        stellarTxId: txIdToRecord,
        status: 'confirmed',
      }),
    );
  }

  if (!hasFarmer && deal.farmer?.walletAddress) {
    missingRows.push(
      distributionRepo.create({
        tradeDealId,
        recipientType: 'farmer',
        recipientId: deal.farmer.id || null,
        walletAddress: deal.farmer.walletAddress,
        amountUsd: farmerAmount,
        stellarTxId: txIdToRecord,
        status: 'confirmed',
      }),
    );
  }

  for (let i = 0; i < investments.length; i++) {
    const inv = investments[i];
    if (inv.investorId && !existingInvestorUserIds.has(inv.investorId)) {
      missingRows.push(
        distributionRepo.create({
          tradeDealId,
          recipientType: 'investor',
          recipientId: inv.investorId,
          walletAddress: inv.investor?.walletAddress || '',
          amountUsd: investorAmounts[i] || 0,
          stellarTxId: txIdToRecord,
          status: 'confirmed',
        }),
      );
    }
  }

  if (missingRows.length > 0) {
    await distributionRepo.save(missingRows);
  }

  if (deal.status !== 'completed') {
    await dealRepo.update(tradeDealId, {
      status: 'completed',
    });
  }

  return {
    tradeDealId,
    reconciled: true,
    insertedCount: missingRows.length,
    dealStatus: 'completed',
    stellarTxId: verifiedTxId,
  };
}

export interface ReconciliationResult {
  id: string;
  tradeDealId: string;
  stellarTxId: string;
  walletAddress: string;
  recipientType: string;
  dbAmount: string;
  onChainAmount: string | null;
  match: boolean;
  note?: string;
}

interface DistributionRow {
  id: string;
  tradeDealId: string;
  recipientType: string;
  walletAddress: string;
  amountUsd: string | number;
  stellarTxId: string;
}

interface TransactionOperations {
  successful: boolean;
  paymentsByWallet: Map<string, bigint[]>;
}

function toStroops(value: unknown): bigint {
  const raw = String(value ?? '').trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) {
    throw new Error(`Invalid decimal amount: ${raw}`);
  }

  const negative = raw.startsWith('-');
  const [whole = '0', fraction = ''] = raw.replace('-', '').split('.');
  const stroops =
    BigInt(whole) * STROOPS_PER_UNIT +
    BigInt((fraction + '0000000').slice(0, 7));

  return negative ? -stroops : stroops;
}

function formatAmount(stroops: bigint): string {
  const negative = stroops < BigInt(0);
  const absolute = negative ? -stroops : stroops;
  const whole = absolute / STROOPS_PER_UNIT;
  const fraction = (absolute % STROOPS_PER_UNIT)
    .toString()
    .padStart(7, '0');

  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function getHorizonUrl(): string {
  const urls = process.env.STELLAR_HORIZON_URLS;
  if (urls) {
    const [first] = urls
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean);
    if (first) {
      return first;
    }
  }

  return (
    process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org'
  );
}

async function loadOperations(
  server: Horizon.Server,
  txId: string,
): Promise<TransactionOperations> {
  const tx = (await server.transactions().transaction(txId).call()) as any;
  if (!tx.successful) {
    return { successful: false, paymentsByWallet: new Map() };
  }

  const page = (await server.operations().forTransaction(txId).call()) as any;
  const paymentsByWallet = new Map<string, bigint[]>();

  for (const op of page.records ?? []) {
    if (
      !['payment', 'path_payment_strict_receive', 'path_payment_strict_send'].includes(
        op.type,
      ) ||
      !op.to
    ) {
      continue;
    }

    const wallet = String(op.to).toUpperCase();
    const amounts = paymentsByWallet.get(wallet) ?? [];
    amounts.push(toStroops(op.amount));
    paymentsByWallet.set(wallet, amounts);
  }

  return { successful: true, paymentsByWallet };
}

function takeOnChainAmount(
  tx: TransactionOperations,
  walletAddress: string,
  expected: bigint,
): bigint | null {
  const amounts = tx.paymentsByWallet.get(walletAddress.toUpperCase());
  if (!amounts || amounts.length === 0) {
    return null;
  }

  const exactIndex = amounts.indexOf(expected);
  const index = exactIndex >= 0 ? exactIndex : 0;
  return amounts.splice(index, 1)[0];
}

export async function reconcileOnChainVsDb(
  dataSource: DataSource,
  limit = 100,
  server?: Horizon.Server,
): Promise<ReconciliationResult[]> {
  const horizon = server ?? new Horizon.Server(getHorizonUrl());

  const rows: DistributionRow[] = await dataSource.query(
    `SELECT id, trade_deal_id AS "tradeDealId", recipient_type AS "recipientType",
            wallet_address AS "walletAddress", amount_usd AS "amountUsd",
            stellar_tx_id AS "stellarTxId"
     FROM payment_distributions
     WHERE stellar_tx_id IS NOT NULL AND status = 'confirmed'
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  );

  const txCache = new Map<string, Promise<TransactionOperations>>();
  const results: ReconciliationResult[] = [];

  for (const row of rows) {
    const expected = toStroops(row.amountUsd);
    let result: ReconciliationResult;

    try {
      let txRequest = txCache.get(row.stellarTxId);
      if (!txRequest) {
        txRequest = loadOperations(horizon, row.stellarTxId);
        txCache.set(row.stellarTxId, txRequest);
      }

      const tx = await txRequest;
      if (!tx.successful) {
        result = {
          id: row.id,
          tradeDealId: row.tradeDealId,
          stellarTxId: row.stellarTxId,
          walletAddress: row.walletAddress,
          recipientType: row.recipientType,
          dbAmount: formatAmount(expected),
          onChainAmount: null,
          match: false,
          note: 'transaction_failed_on_chain',
        };
      } else {
        const actual = takeOnChainAmount(tx, row.walletAddress, expected);
        result = {
          id: row.id,
          tradeDealId: row.tradeDealId,
          stellarTxId: row.stellarTxId,
          walletAddress: row.walletAddress,
          recipientType: row.recipientType,
          dbAmount: formatAmount(expected),
          onChainAmount: actual === null ? null : formatAmount(actual),
          match: actual === expected,
          note: actual === null ? 'no_matching_payment_operation' : undefined,
        };
      }
    } catch (err: any) {
      result = {
        id: row.id,
        tradeDealId: row.tradeDealId,
        stellarTxId: row.stellarTxId,
        walletAddress: row.walletAddress,
        recipientType: row.recipientType,
        dbAmount: formatAmount(expected),
        onChainAmount: null,
        match: false,
        note: `horizon_error: ${err.message}`,
      };
    }

    results.push(result);
  }

  return results;
}

export async function main(): Promise<void> {
  const limitFlag = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitFlag ? Number(limitFlag.split('=')[1]) || 100 : 100;

  await AppDataSource.initialize();
  try {
    const results = await reconcileOnChainVsDb(AppDataSource, limit);
    const mismatched = results.filter((result) => !result.match).length;

    console.log(
      JSON.stringify(
        {
          checked: results.length,
          matched: results.length - mismatched,
          mismatched,
          horizonUrl: getHorizonUrl(),
          results,
        },
        null,
        2,
      ),
    );

    if (mismatched > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`reconcile-onchain-db failed: ${err.message}`);
    process.exit(1);
  });
}
