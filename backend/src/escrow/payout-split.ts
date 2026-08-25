/**
 * #891 — Deal co-investment payout splitting.
 *
 * A deal's delivery payment is split between the lead farmer and any accepted
 * co-farmers according to each co-farmer's committed `portionPercent`. The
 * lead farmer receives whatever remains of the pool (100% minus the sum of
 * committed co-farmer portions).
 *
 * Kept dependency-free and pure so the arithmetic can be exhaustively unit
 * tested (`payout-split.spec.ts`) without any NestJS/DI machinery.
 */

/** One payout recipient with the weight (portion %) they are entitled to. */
export interface PayoutParticipant {
  farmerId: string;
  walletAddress: string | null;
  /** Entitlement weight in percent. Co-farmers commit an explicit portion; */
  /** the lead farmer's weight is derived as 100 − Σ(co-farmer portions).   */
  portionPercent: number;
}

export interface FarmerPayout {
  recipientId: string;
  walletAddress: string | null;
  amountUsd: number;
}

/**
 * Splits `netPoolUsd` across participants proportionally to their weights.
 *
 * - Works entirely in integer cents to avoid floating-point drift.
 * - Every participant except the last receives floor(pool × weight / totalWeight);
 *   the last participant absorbs the rounding remainder so the split always
 *   sums exactly to the pool.
 * - Zero-weight recipients produce zero-cent allocations which are dropped
 *   from the result (no junk rows persisted).
 */
export function computeFarmerPayoutSplits(
  netPoolUsd: number,
  participants: PayoutParticipant[],
): FarmerPayout[] {
  if (participants.length === 0) return [];

  const totalWeight = participants.reduce(
    (sum, p) => sum + Math.max(p.portionPercent, 0),
    0,
  );
  if (totalWeight <= 0) {
    throw new Error('Cannot split payout without positive weights.');
  }

  const totalCents = Math.round((netPoolUsd + Number.EPSILON) * 100);
  let allocatedCents = 0;

  const rows: FarmerPayout[] = participants.map((participant, index) => {
    let cents: number;
    if (index === participants.length - 1) {
      cents = totalCents - allocatedCents;
    } else {
      const weight = Math.max(participant.portionPercent, 0);
      cents = Math.floor((totalCents * weight) / totalWeight);
      allocatedCents += cents;
    }

    return {
      recipientId: participant.farmerId,
      walletAddress: participant.walletAddress,
      amountUsd: cents / 100,
    };
  });

  return rows.filter((row) => row.amountUsd > 0);
}
