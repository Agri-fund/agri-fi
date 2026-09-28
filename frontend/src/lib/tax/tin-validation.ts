/**
 * Tax Identification Number (TIN) validation for different jurisdictions.
 * Validates format and structure per country requirements.
 */

export type JurisdictionCode = 'US' | 'UK' | 'CA' | 'AU' | 'EU' | 'ZA' | 'IN' | 'SG';

export interface JurisdictionConfig {
  code: JurisdictionCode;
  name: string;
  label: string; // e.g., "SSN", "National Insurance Number", "TIN"
  format: string; // Display format, e.g., "XXX-XX-XXXX"
  regex: RegExp;
  mask?: string; // For input masking
  example: string;
}

/**
 * Jurisdiction-specific TIN validation rules.
 * Based on standard government TIN formats.
 */
export const JURISDICTION_CONFIGS: Record<JurisdictionCode, JurisdictionConfig> = {
  US: {
    code: 'US',
    name: 'United States',
    label: 'SSN (Social Security Number)',
    format: 'XXX-XX-XXXX',
    regex: /^\d{3}-\d{2}-\d{4}$|^\d{9}$/,
    mask: '999-99-9999',
    example: '123-45-6789',
  },
  UK: {
    code: 'UK',
    name: 'United Kingdom',
    label: 'NINO (National Insurance Number)',
    format: 'AB123456C',
    regex: /^[A-Z]{2}[0-9]{6}[A-Z]$/,
    example: 'AB123456C',
  },
  CA: {
    code: 'CA',
    name: 'Canada',
    label: 'SIN (Social Insurance Number)',
    format: 'XXX-XXX-XXX',
    regex: /^\d{3}-\d{3}-\d{3}$|^\d{9}$/,
    mask: '999-999-999',
    example: '123-456-789',
  },
  AU: {
    code: 'AU',
    name: 'Australia',
    label: 'TFN (Tax File Number)',
    format: 'XXX XXX XXX',
    regex: /^\d{3} \d{3} \d{3}$|^\d{9}$/,
    mask: '999 999 999',
    example: '123 456 789',
  },
  EU: {
    code: 'EU',
    name: 'European Union',
    label: 'VAT Number / Tax ID',
    format: 'Variable by country',
    regex: /^[A-Z]{2}[A-Z0-9]{2,12}$/i,
    example: 'DE123456789',
  },
  ZA: {
    code: 'ZA',
    name: 'South Africa',
    label: 'TIN',
    format: 'XXXXXXXXXRXX',
    regex: /^\d{10}[A-Z]{1}\d{2}$/,
    example: '1234567890A01',
  },
  IN: {
    code: 'IN',
    name: 'India',
    label: 'PAN (Permanent Account Number)',
    format: 'XXXXXAXXXX',
    regex: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/,
    example: 'AAAAA0000A',
  },
  SG: {
    code: 'SG',
    name: 'Singapore',
    label: 'NRIC/FIN',
    format: 'XXXYYYYZZZZ',
    regex: /^[STNFG]\d{7}[A-Z]$/i,
    example: 'S1234567A',
  },
};

/**
 * Validates TIN format for a specific jurisdiction.
 */
export function validateTIN(tin: string, jurisdiction: JurisdictionCode): {
  valid: boolean;
  error?: string;
} {
  const config = JURISDICTION_CONFIGS[jurisdiction];
  if (!config) {
    return { valid: false, error: `Unknown jurisdiction: ${jurisdiction}` };
  }

  const cleaned = tin.replace(/\s|-/g, '').toUpperCase();

  if (!cleaned) {
    return { valid: false, error: `${config.label} is required` };
  }

  if (cleaned.length < 6) {
    return { valid: false, error: `${config.label} too short` };
  }

  if (!config.regex.test(cleaned)) {
    return {
      valid: false,
      error: `${config.label} format invalid. Expected: ${config.format} (example: ${config.example})`,
    };
  }

  // Additional validation for specific jurisdictions
  if (jurisdiction === 'US') {
    return validateUSSSN(cleaned);
  }

  return { valid: true };
}

/**
 * Additional validation rules for US SSN.
 * Checks for known invalid patterns.
 */
function validateUSSSN(ssn: string): { valid: boolean; error?: string } {
  const cleaned = ssn.replace('-', '');

  // Invalid patterns
  if (cleaned === '000000000' || cleaned === '111111111' || cleaned === '666666666') {
    return { valid: false, error: 'Invalid SSN pattern (all same digits)' };
  }

  if (cleaned.startsWith('000') || cleaned.startsWith('666') || cleaned.substring(5, 9) === '0000') {
    return { valid: false, error: 'Invalid SSN pattern' };
  }

  if (cleaned.substring(3, 5) === '00') {
    return { valid: false, error: 'Invalid SSN group number' };
  }

  return { valid: true };
}

/**
 * Formats TIN for display according to jurisdiction.
 */
export function formatTIN(tin: string, jurisdiction: JurisdictionCode): string {
  const config = JURISDICTION_CONFIGS[jurisdiction];
  if (!config) return tin;

  const cleaned = tin.replace(/\s|-/g, '');

  switch (jurisdiction) {
    case 'US':
    case 'CA':
      return cleaned.replace(/(\d{3})(\d{2})(\d{4})/, '$1-$2-$3');
    case 'AU':
      return cleaned.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
    case 'UK':
    case 'EU':
    case 'IN':
    case 'SG':
      return cleaned.toUpperCase();
    case 'ZA':
      return cleaned.replace(/(\d{10})([A-Z])(\d{2})/, '$1$2$3');
    default:
      return cleaned;
  }
}

/**
 * Gets all available jurisdictions for dropdown.
 */
export function getJurisdictionOptions(): Array<{ value: JurisdictionCode; label: string }> {
  return Object.values(JURISDICTION_CONFIGS).map((config) => ({
    value: config.code,
    label: `${config.name} (${config.label})`,
  }));
}
