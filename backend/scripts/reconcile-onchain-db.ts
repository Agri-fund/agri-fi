import { Horizon } from '@stellar/stellar-sdk';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../src/database/data-source';

const STROOPS_PER_UNIT = BigInt(10_000_000);

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
