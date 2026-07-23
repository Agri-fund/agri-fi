const DEAL_ID_MEMO_LENGTH = 8;

export function normalizeDealIdForMemo(dealId: string): string {
  return dealId.replace(/-/g, '').slice(0, DEAL_ID_MEMO_LENGTH);
}

export function buildShipmentMemo(
  dealId: string,
  milestone: string,
  unixTimestamp: number = Math.floor(Date.now() / 1000),
): string {
  return `AGRIC:MILESTONE:${normalizeDealIdForMemo(dealId)}:${milestone}:${unixTimestamp}`;
}

export function buildDocumentMemo(tradeDealId: string, hash: string): string {
  return `AGRIC:DOC:${tradeDealId}:${hash}`;
}
