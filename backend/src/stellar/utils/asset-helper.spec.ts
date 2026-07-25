import { Asset, Keypair } from '@stellar/stellar-sdk';
import { parseAsset, validateAsset, createAsset } from './asset-helper';

const VALID_ISSUER = Keypair.random().publicKey();

describe('parseAsset', () => {
  it('parses "native" (case-insensitive) as native XLM asset', () => {
    expect(parseAsset('native').isNative()).toBe(true);
    expect(parseAsset('NATIVE').isNative()).toBe(true);
    expect(parseAsset('Native').isNative()).toBe(true);
  });

  it('parses "XLM" as native asset', () => {
    expect(parseAsset('XLM').isNative()).toBe(true);
    expect(parseAsset('xlm').isNative()).toBe(true);
  });

  it('parses "CODE-ISSUER" into a non-native Asset', () => {
    const asset = parseAsset(`USDC-${VALID_ISSUER}`);
    expect(asset.isNative()).toBe(false);
    expect(asset.getCode()).toBe('USDC');
    expect(asset.getIssuer()).toBe(VALID_ISSUER);
  });

  it('parses an alphanum4 code (1–4 chars)', () => {
    const asset = parseAsset(`XLM2-${VALID_ISSUER}`);
    expect(asset.getCode()).toBe('XLM2');
  });

  it('parses an alphanum12 code (5–12 chars)', () => {
    const asset = parseAsset(`COCOA1-${VALID_ISSUER}`);
    expect(asset.getCode()).toBe('COCOA1');
  });

  it('parses a 1-character code', () => {
    const asset = parseAsset(`A-${VALID_ISSUER}`);
    expect(asset.getCode()).toBe('A');
    expect(asset.getIssuer()).toBe(VALID_ISSUER);
  });

  it('parses a 12-character code', () => {
    const asset = parseAsset(`ABCDEFGHIJKL-${VALID_ISSUER}`);
    expect(asset.getCode()).toBe('ABCDEFGHIJKL');
  });

  it('trims surrounding whitespace from the descriptor', () => {
    const asset = parseAsset(`  USDC-${VALID_ISSUER}  `);
    expect(asset.getCode()).toBe('USDC');
    expect(asset.getIssuer()).toBe(VALID_ISSUER);
  });

  it('throws on empty string', () => {
    expect(() => parseAsset('')).toThrow('Asset descriptor must be a non-empty string');
  });

  it('throws when descriptor has no hyphen and is not native/XLM', () => {
    expect(() => parseAsset('USDC')).toThrow(/expected "CODE-ISSUER"/);
  });

  it('throws on invalid asset code (too long)', () => {
    expect(() => parseAsset(`TOOLONGCODE123-${VALID_ISSUER}`)).toThrow(
      /Invalid asset code/,
    );
  });

  it('throws on invalid asset code (empty before hyphen)', () => {
    expect(() => parseAsset(`-${VALID_ISSUER}`)).toThrow(/Asset code must be a non-empty string/);
  });

  it('throws on invalid issuer public key', () => {
    expect(() => parseAsset('USDC-NOTAVALIDKEY')).toThrow(/Invalid asset issuer/);
  });

  it('throws on missing issuer (trailing hyphen)', () => {
    expect(() => parseAsset('USDC-')).toThrow(/Asset issuer must be a non-empty string/);
  });

  it('returns an Asset equal to one constructed directly', () => {
    const expected = new Asset('USDC', VALID_ISSUER);
    const parsed = parseAsset(`USDC-${VALID_ISSUER}`);
    expect(parsed.equals(expected)).toBe(true);
  });
});

describe('validateAsset', () => {
  it('does not throw for valid code and issuer', () => {
    expect(() => validateAsset('USDC', VALID_ISSUER)).not.toThrow();
  });

  it('throws for empty code', () => {
    expect(() => validateAsset('', VALID_ISSUER)).toThrow('Asset code must be a non-empty string');
  });

  it('throws for code longer than 12 characters', () => {
    expect(() => validateAsset('ABCDEFGHIJKLM', VALID_ISSUER)).toThrow(/Invalid asset code/);
  });

  it('throws for code with special characters', () => {
    expect(() => validateAsset('US-DC', VALID_ISSUER)).toThrow(/Invalid asset code/);
  });

  it('throws for invalid issuer', () => {
    expect(() => validateAsset('USDC', 'bad-key')).toThrow(/Invalid asset issuer/);
  });
});

describe('createAsset', () => {
  it('creates an Asset from valid code and issuer', () => {
    const asset = createAsset('COCOA1', VALID_ISSUER);
    expect(asset.getCode()).toBe('COCOA1');
    expect(asset.getIssuer()).toBe(VALID_ISSUER);
  });

  it('trims whitespace from code and issuer', () => {
    const asset = createAsset('  USDC  ', `  ${VALID_ISSUER}  `);
    expect(asset.getCode()).toBe('USDC');
    expect(asset.getIssuer()).toBe(VALID_ISSUER);
  });

  it('throws for invalid inputs', () => {
    expect(() => createAsset('', VALID_ISSUER)).toThrow();
    expect(() => createAsset('USDC', '')).toThrow();
  });
});
