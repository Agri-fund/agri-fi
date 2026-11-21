import { DataSource } from 'typeorm';
import { TradeDeal } from '../src/trade-deals/entities/trade-deal.entity';
import { Investment } from '../src/investments/entities/investment.entity';
import { PaymentDistribution } from '../src/escrow/entities/payment-distribution.entity';
import { StellarService } from '../src/stellar/stellar.service';

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
  // 1. Query the Stellar Horizon API for the TX if txId is supplied
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

  // 2. Fetch existing PaymentDistribution records
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

  // 3. Re-derive payout amounts
  const totalValue = Number(deal.totalValue);
  const totalCents = Math.round(totalValue * 100);
  const platformCents = Math.round(totalCents * 0.02);
  const investorPoolCents = totalCents - platformCents;
  const platformAmount = platformCents / 100;
  const investorPool = investorPoolCents / 100;
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

  // 4. Construct missing PaymentDistribution rows
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

  // 5. Persist missing rows and update deal status
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

/** Existing random sampling check */
export async function reconcileOnChainVsDb(
  dataSource: DataSource,
  sampleCount = 10,
) {
  const investments = await dataSource.query(
    `SELECT id, amount_usd FROM investments ORDER BY RANDOM() LIMIT $1`,
    [sampleCount],
  );

  const results = investments.map((inv: any) => {
    const dbAmount = String(inv.amount_usd);
    const stroops = Math.round(Number(dbAmount) * 10_000_000);
    const recheckedAmount = (stroops / 10_000_000).toFixed(7);
    const match = Number(dbAmount).toFixed(7) === recheckedAmount;
    return {
      id: inv.id,
      dbAmount,
      stroops,
      recheckedAmount,
      match,
    };
  });

  return results;
}
