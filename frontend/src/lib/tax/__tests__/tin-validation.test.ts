import { validateTIN, formatTIN, getJurisdictionOptions, JURISDICTION_CONFIGS } from '../tin-validation';

describe('TIN Validation', () => {
  describe('US SSN Validation', () => {
    it('should accept valid SSN format with dashes', () => {
      const result = validateTIN('123-45-6789', 'US');
      expect(result.valid).toBe(true);
    });

    it('should accept valid SSN format without dashes', () => {
      const result = validateTIN('123456789', 'US');
      expect(result.valid).toBe(true);
    });

    it('should reject all zeros', () => {
      const result = validateTIN('000-00-0000', 'US');
      expect(result.valid).toBe(false);
    });

    it('should reject all same digits', () => {
      const result = validateTIN('111-11-1111', 'US');
      expect(result.valid).toBe(false);
    });

    it('should reject SSN starting with 666', () => {
      const result = validateTIN('666-12-3456', 'US');
      expect(result.valid).toBe(false);
    });

    it('should reject invalid format', () => {
      const result = validateTIN('123-4567', 'US');
      expect(result.valid).toBe(false);
    });
  });

  describe('UK NINO Validation', () => {
    it('should accept valid NINO format', () => {
      const result = validateTIN('AB123456C', 'UK');
      expect(result.valid).toBe(true);
    });

    it('should accept lowercase NINO', () => {
      const result = validateTIN('ab123456c', 'UK');
      expect(result.valid).toBe(true);
    });

    it('should reject NINO with wrong format', () => {
      const result = validateTIN('A1234567', 'UK');
      expect(result.valid).toBe(false);
    });

    it('should reject NINO with too many digits', () => {
      const result = validateTIN('ABC123456C', 'UK');
      expect(result.valid).toBe(false);
    });
  });

  describe('Canada SIN Validation', () => {
    it('should accept valid SIN format with dashes', () => {
      const result = validateTIN('123-456-789', 'CA');
      expect(result.valid).toBe(true);
    });

    it('should accept valid SIN format without dashes', () => {
      const result = validateTIN('123456789', 'CA');
      expect(result.valid).toBe(true);
    });

    it('should reject SIN with invalid format', () => {
      const result = validateTIN('123-45-6789', 'CA');
      expect(result.valid).toBe(false);
    });
  });

  describe('Australia TFN Validation', () => {
    it('should accept valid TFN format with spaces', () => {
      const result = validateTIN('123 456 789', 'AU');
      expect(result.valid).toBe(true);
    });

    it('should accept valid TFN format without spaces', () => {
      const result = validateTIN('123456789', 'AU');
      expect(result.valid).toBe(true);
    });

    it('should reject TFN with invalid format', () => {
      const result = validateTIN('123-456-789', 'AU');
      expect(result.valid).toBe(false);
    });
  });

  describe('India PAN Validation', () => {
    it('should accept valid PAN format', () => {
      const result = validateTIN('AAAAA0000A', 'IN');
      expect(result.valid).toBe(true);
    });

    it('should accept lowercase PAN', () => {
      const result = validateTIN('aaaaa0000a', 'IN');
      expect(result.valid).toBe(true);
    });

    it('should reject PAN with invalid format', () => {
      const result = validateTIN('AAAA00000A', 'IN');
      expect(result.valid).toBe(false);
    });

    it('should reject PAN with wrong structure', () => {
      const result = validateTIN('123AA0000A', 'IN');
      expect(result.valid).toBe(false);
    });
  });

  describe('Singapore NRIC Validation', () => {
    it('should accept valid NRIC format', () => {
      const result = validateTIN('S1234567A', 'SG');
      expect(result.valid).toBe(true);
    });

    it('should accept different valid NRIC prefixes', () => {
      expect(validateTIN('T1234567A', 'SG').valid).toBe(true);
      expect(validateTIN('N1234567A', 'SG').valid).toBe(true);
      expect(validateTIN('F1234567A', 'SG').valid).toBe(true);
      expect(validateTIN('G1234567A', 'SG').valid).toBe(true);
    });

    it('should reject invalid NRIC format', () => {
      const result = validateTIN('S123456', 'SG');
      expect(result.valid).toBe(false);
    });

    it('should reject invalid prefix', () => {
      const result = validateTIN('X1234567A', 'SG');
      expect(result.valid).toBe(false);
    });
  });

  describe('South Africa TIN Validation', () => {
    it('should accept valid ZA TIN format', () => {
      const result = validateTIN('1234567890A01', 'ZA');
      expect(result.valid).toBe(true);
    });

    it('should reject ZA TIN with invalid format', () => {
      const result = validateTIN('123456789A01', 'ZA');
      expect(result.valid).toBe(false);
    });
  });

  describe('TIN Formatting', () => {
    it('should format US SSN correctly', () => {
      expect(formatTIN('123456789', 'US')).toBe('123-45-6789');
    });

    it('should format Canadian SIN correctly', () => {
      expect(formatTIN('123456789', 'CA')).toBe('123-456-789');
    });

    it('should format Australian TFN correctly', () => {
      expect(formatTIN('123456789', 'AU')).toBe('123 456 789');
    });

    it('should uppercase UK NINO', () => {
      expect(formatTIN('ab123456c', 'UK')).toBe('AB123456C');
    });

    it('should uppercase Indian PAN', () => {
      expect(formatTIN('aaaaa0000a', 'IN')).toBe('AAAAA0000A');
    });
  });

  describe('Error Messages', () => {
    it('should provide helpful error for invalid SSN', () => {
      const result = validateTIN('123-45', 'US');
      expect(result.error).toContain('format invalid');
    });

    it('should suggest correct format in error', () => {
      const result = validateTIN('123', 'US');
      expect(result.error).toContain('XXX-XX-XXXX');
    });

    it('should require TIN when empty', () => {
      const result = validateTIN('', 'US');
      expect(result.error).toContain('required');
    });
  });

  describe('Jurisdiction Options', () => {
    it('should return all jurisdiction options', () => {
      const options = getJurisdictionOptions();
      expect(options.length).toBeGreaterThan(0);
      expect(options.some((o) => o.value === 'US')).toBe(true);
      expect(options.some((o) => o.value === 'UK')).toBe(true);
    });

    it('should include label with TIN type', () => {
      const options = getJurisdictionOptions();
      const us = options.find((o) => o.value === 'US');
      expect(us?.label).toContain('SSN');
    });
  });

  describe('Jurisdiction Configs', () => {
    it('should have config for all major jurisdictions', () => {
      expect(JURISDICTION_CONFIGS.US).toBeDefined();
      expect(JURISDICTION_CONFIGS.UK).toBeDefined();
      expect(JURISDICTION_CONFIGS.CA).toBeDefined();
      expect(JURISDICTION_CONFIGS.AU).toBeDefined();
      expect(JURISDICTION_CONFIGS.IN).toBeDefined();
      expect(JURISDICTION_CONFIGS.SG).toBeDefined();
    });

    it('should have regex and format info for each config', () => {
      Object.values(JURISDICTION_CONFIGS).forEach((config) => {
        expect(config.regex).toBeDefined();
        expect(config.format).toBeDefined();
        expect(config.label).toBeDefined();
        expect(config.example).toBeDefined();
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle whitespace in TIN', () => {
      const result = validateTIN('  123-45-6789  ', 'US');
      // TIN validation removes whitespace internally
      expect(result.valid).toBe(true);
    });

    it('should handle mixed case for case-insensitive formats', () => {
      const result = validateTIN('Ab123456c', 'UK');
      expect(result.valid).toBe(true);
    });

    it('should reject too short TIN', () => {
      const result = validateTIN('123', 'US');
      expect(result.valid).toBe(false);
    });

    it('should reject unknown jurisdiction', () => {
      const result = validateTIN('123456789', 'XX' as any);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unknown jurisdiction');
    });
  });
});
