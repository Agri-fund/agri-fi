import {
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  Asset,
  BASE_FEE,
  Memo,
} from '@stellar/stellar-sdk';
import { parseXdr } from './xdr-parser';

const NETWORK = Networks.TESTNET;

const mockAccount = (publicKey: string) => ({
  accountId: () => publicKey,
  sequenceNumber: () => '100',
  incrementSequenceNumber: jest.fn(),
  subentry_count: 0,
  balances: [],
  flags: {},
  signers: [],
  thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
  sequence: '100',
  loadedAt: new Date(),
});

function buildXdr(ops: any[], memo?: Memo): string {
  const kp = Keypair.random();
  let builder = new TransactionBuilder(mockAccount(kp.publicKey()) as any, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK,
  });
  ops.forEach((op) => builder.addOperation(op));
  if (memo) builder = builder.addMemo(memo);
  return builder.setTimeout(30).build().toXDR();
}

describe('parseXdr', () => {
  const issuer = Keypair.random();
  const recipient = Keypair.random();
  const tradeAsset = new Asset('COCOA1', issuer.publicKey());

  it('parses a payment operation', () => {
    const xdr = buildXdr([
      Operation.payment({
        destination: recipient.publicKey(),
        asset: Asset.native(),
        amount: '100',
      }),
    ]);

    const result = parseXdr(xdr);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].type).toBe('payment');
    expect(result.operations[0].destination).toBe(recipient.publicKey());
    expect(result.operations[0].amount).toBe('100.0000000');
    expect(result.operations[0].asset).toBe('XLM');
  });

  it('parses a changeTrust operation (add trustline)', () => {
    const xdr = buildXdr([Operation.changeTrust({ asset: tradeAsset })]);

    const result = parseXdr(xdr);
    expect(result.operations[0].type).toBe('changeTrust');
    expect(result.operations[0].asset).toBe(`COCOA1:${issuer.publicKey()}`);
  });

  it('parses a changeTrust with limit=0 (remove trustline)', () => {
    const xdr = buildXdr([
      Operation.changeTrust({ asset: tradeAsset, limit: '0' }),
    ]);

    const result = parseXdr(xdr);
    expect(result.operations[0].type).toBe('changeTrust');
    expect(result.operations[0].limit).toBe('0.0000000');
  });

  it('parses a manageSellOffer operation', () => {
    const usdcIssuer = Keypair.random();
    const usdc = new Asset('USDC', usdcIssuer.publicKey());

    const xdr = buildXdr([
      Operation.manageSellOffer({
        selling: tradeAsset,
        buying: usdc,
        amount: '10',
        price: '1.5',
      }),
    ]);

    const result = parseXdr(xdr);
    expect(result.operations[0].type).toBe('manageSellOffer');
    expect(result.operations[0].selling).toContain('COCOA1');
    expect(result.operations[0].buying).toContain('USDC');
    expect(result.operations[0].price).toBe('1.5');
  });

  it('parses a manageData operation', () => {
    const xdr = buildXdr([
      Operation.manageData({ name: 'fatf_1', value: 'dGVzdA==' }),
    ]);

    const result = parseXdr(xdr);
    expect(result.operations[0].type).toBe('manageData');
    expect(result.operations[0].name).toBe('fatf_1');
  });

  it('parses a createAccount operation', () => {
    const dest = Keypair.random();
    const xdr = buildXdr([
      Operation.createAccount({
        destination: dest.publicKey(),
        startingBalance: '3',
      }),
    ]);

    const result = parseXdr(xdr);
    expect(result.operations[0].type).toBe('createAccount');
    expect(result.operations[0].destination).toBe(dest.publicKey());
  });

  it('parses fee from transaction envelope', () => {
    const xdr = buildXdr([
      Operation.payment({
        destination: recipient.publicKey(),
        asset: Asset.native(),
        amount: '1',
      }),
    ]);

    const result = parseXdr(xdr);
    expect(result.fee).toBeDefined();
    expect(Number(result.fee)).toBeGreaterThan(0);
  });

  it('parses memo text', () => {
    const xdr = buildXdr(
      [
        Operation.payment({
          destination: recipient.publicKey(),
          asset: Asset.native(),
          amount: '1',
        }),
      ],
      Memo.text('invest:COCOA1:1'),
    );

    const result = parseXdr(xdr);
    expect(result.memo.type).toBe('text');
    expect(result.memo.value).toBe('invest:COCOA1:1');
  });

  it('parses multi-operation escrow release transaction', () => {
    const farmer = Keypair.random();
    const investor = Keypair.random();
    const platform = Keypair.random();
    const usdcIssuer = Keypair.random();
    const usdc = new Asset('USDC', usdcIssuer.publicKey());

    const xdr = buildXdr([
      Operation.payment({
        destination: farmer.publicKey(),
        asset: usdc,
        amount: '98',
      }),
      Operation.payment({
        destination: investor.publicKey(),
        asset: usdc,
        amount: '1.96',
      }),
      Operation.payment({
        destination: platform.publicKey(),
        asset: usdc,
        amount: '2',
      }),
    ]);

    const result = parseXdr(xdr);
    expect(result.operations).toHaveLength(3);
    result.operations.forEach((op) => {
      expect(op.type).toBe('payment');
      expect(op.asset).toContain('USDC');
    });
  });

  it('throws on invalid XDR', () => {
    expect(() => parseXdr('not-valid-xdr')).toThrow();
  });
});
