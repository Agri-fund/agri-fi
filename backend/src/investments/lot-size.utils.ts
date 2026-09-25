/**
 * Lot size validation for fractional investments (#835).
 *
 * An investment amount is valid when:
 *   amount >= minLotSize AND (amount - minLotSize) % lotStep === 0
 */
export interface LotSizeValidationResult {
  valid: boolean;
  code?: 'LOT_SIZE_BELOW_MIN' | 'LOT_SIZE_INVALID_STEP';
  message?: string;
}

export function validateLotSize(
  amountUsd: number,
  minLotSize: number,
  lotStep: number,
): LotSizeValidationResult {
  const min = Number(minLotSize);
  const step = Number(lotStep);

  if (amountUsd < min) {
    return {
      valid: false,
      code: 'LOT_SIZE_BELOW_MIN',
      message: `Minimum investment for this deal is ${min} USD.`,
    };
  }

  if (step > 0 && (amountUsd - min) % step !== 0) {
    return {
      valid: false,
      code: 'LOT_SIZE_INVALID_STEP',
      message: `Investment amount must be the minimum (${min} USD) plus a multiple of ${step} USD.`,
    };
  }

  return { valid: true };
}
