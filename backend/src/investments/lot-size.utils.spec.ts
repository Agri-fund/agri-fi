import { validateLotSize } from './lot-size.utils';

describe('validateLotSize (#835)', () => {
  it('accepts the minimum lot size exactly', () => {
    expect(validateLotSize(50, 50, 10).valid).toBe(true);
  });

  it('accepts amounts aligned to the lot step', () => {
    expect(validateLotSize(80, 50, 10).valid).toBe(true);
    expect(validateLotSize(150, 50, 10).valid).toBe(true);
  });

  it('rejects amounts below the minimum lot size', () => {
    const result = validateLotSize(40, 50, 10);
    expect(result.valid).toBe(false);
    expect(result.code).toBe('LOT_SIZE_BELOW_MIN');
  });

  it('rejects amounts not aligned to the lot step', () => {
    const result = validateLotSize(55, 50, 10);
    expect(result.valid).toBe(false);
    expect(result.code).toBe('LOT_SIZE_INVALID_STEP');
  });

  it('allows any amount above the minimum when lot step is zero', () => {
    expect(validateLotSize(73.25, 50, 0).valid).toBe(true);
  });

  it('defaults (1, 1) behave like a simple minimum check', () => {
    expect(validateLotSize(100, 1, 1).valid).toBe(true);
    expect(validateLotSize(0.5, 1, 1).valid).toBe(false);
  });
});
