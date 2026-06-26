import { Asset, Keypair } from '@stellar/stellar-sdk';

/**
 * Validates asset code and issuer before constructing a Stellar Asset,
 * preventing SDK exceptions from malformed input.
 *
 * Rules (per Stellar protocol):
 *  - alphanum4:  1–4 alphanumeric characters
 *  - alphanum12: 5–12 alphanumeric characters
 *  - issuer must be a valid Stellar public key (G…, 56 chars, base32)
 */
export function validateAsset(code: string, issuer: string): void {
  if (!code || typeof code !== 'string') {
    throw new Error('Asset code must be a non-empty string');
  }

  const trimmed = code.trim();
  if (!/^[A-Za-z0-9]{1,12}$/.test(trimmed)) {
    throw new Error(
      `Invalid asset code "${trimmed}": must be 1–12 alphanumeric characters`,
    );
  }

  if (!issuer || typeof issuer !== 'string') {
    throw new Error('Asset issuer must be a non-empty string');
  }

  try {
    Keypair.fromPublicKey(issuer.trim());
  } catch {
    throw new Error(
      `Invalid asset issuer "${issuer}": must be a valid Stellar public key`,
    );
  }
}

/**
 * Creates a Stellar Asset after pre-flight validation.
 * Throws a descriptive error instead of letting the SDK throw an opaque one.
 */
export function createAsset(code: string, issuer: string): Asset {
  validateAsset(code, issuer);
  return new Asset(code.trim(), issuer.trim());
}

/**
 * Parses a "CODE-ISSUER" string into a Stellar Asset instance.
 *
 * Special cases:
 *  - "native" or "XLM" (case-insensitive, no issuer segment) → Asset.native()
 *  - "CODE-ISSUER" → validated non-native asset
 *
 * The separator is the FIRST hyphen found; issuers (G… keys) never contain
 * hyphens, so this split is unambiguous even for codes that contain hyphens
 * in theory—though valid Stellar codes are alphanumeric only.
 */
export function parseAsset(descriptor: string): Asset {
  if (!descriptor || typeof descriptor !== 'string') {
    throw new Error('Asset descriptor must be a non-empty string');
  }

  const trimmed = descriptor.trim();

  if (trimmed.toUpperCase() === 'XLM' || trimmed.toLowerCase() === 'native') {
    return Asset.native();
  }

  const hyphenIndex = trimmed.indexOf('-');
  if (hyphenIndex === -1) {
    throw new Error(
      `Invalid asset descriptor "${trimmed}": expected "CODE-ISSUER" or "native"/"XLM"`,
    );
  }

  const code = trimmed.slice(0, hyphenIndex);
  const issuer = trimmed.slice(hyphenIndex + 1);

  validateAsset(code, issuer);
  return new Asset(code, issuer);
}
