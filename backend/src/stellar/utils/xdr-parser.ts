import { TransactionBuilder, Networks } from '@stellar/stellar-sdk';

export interface ParsedOperation {
  type: string;
  destination?: string;
  amount?: string;
  asset?: string;
  limit?: string;
  offerId?: string;
  selling?: string;
  buying?: string;
  price?: string;
  name?: string;
  value?: string;
  trustor?: string;
  flags?: Record<string, boolean>;
}

export interface ParsedTransaction {
  fee: string;
  memo: { type: string; value?: string };
  operations: ParsedOperation[];
}

/**
 * Decodes a Stellar XDR transaction envelope into a structured JSON object.
 * Supports testnet and mainnet passphrases.
 */
export function parseXdr(
  xdr: string,
  network: 'testnet' | 'mainnet' = 'testnet',
): ParsedTransaction {
  const passphrase =
    network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

  const tx = TransactionBuilder.fromXDR(xdr, passphrase) as any;

  const memo = tx.memo
    ? { type: tx.memo.type, value: tx.memo.value?.toString() }
    : { type: 'none' };

  const operations: ParsedOperation[] = tx.operations.map((op: any) => {
    const parsed: ParsedOperation = { type: op.type };

    if (op.destination !== undefined) parsed.destination = op.destination;
    if (op.amount !== undefined) parsed.amount = op.amount;
    // changeTrust uses `line` for the asset and `limit` for the trust limit
    const assetSource = op.asset ?? op.line;
    if (assetSource !== undefined)
      parsed.asset = assetSource.isNative()
        ? 'XLM'
        : `${assetSource.getCode()}:${assetSource.getIssuer()}`;
    if (op.limit !== undefined) parsed.limit = op.limit;
    if (op.offerId !== undefined) parsed.offerId = String(op.offerId);
    if (op.selling !== undefined)
      parsed.selling = op.selling.isNative()
        ? 'XLM'
        : `${op.selling.getCode()}:${op.selling.getIssuer()}`;
    if (op.buying !== undefined)
      parsed.buying = op.buying.isNative()
        ? 'XLM'
        : `${op.buying.getCode()}:${op.buying.getIssuer()}`;
    if (op.price !== undefined) parsed.price = String(op.price);
    if (op.name !== undefined) parsed.name = op.name;
    if (op.value !== undefined)
      parsed.value =
        op.value instanceof Buffer ? op.value.toString('base64') : op.value;
    if (op.trustor !== undefined) parsed.trustor = op.trustor;
    if (op.flags !== undefined) parsed.flags = op.flags;

    return parsed;
  });

  return {
    fee: tx.fee,
    memo,
    operations,
  };
}
