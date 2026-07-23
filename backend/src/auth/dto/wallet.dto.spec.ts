import { validate } from 'class-validator';
import { WalletDto } from './wallet.dto';

// Generated via Keypair.random() from stellar-sdk v12
const VALID_KEY = 'GB5HA3VWSBWS47VIKMOOMTMA2AHEWREUKA42GFEABACC4MVWL2L7FKGE';

async function validateWallet(address: string) {
  const dto = new WalletDto();
  dto.walletAddress = address;
  return validate(dto);
}

describe('WalletDto — @IsStellarPublicKey', () => {
  it('passes for a valid Stellar public key', async () => {
    const errors = await validateWallet(VALID_KEY);
    expect(errors).toHaveLength(0);
  });

  it('fails for a plain string', async () => {
    const errors = await validateWallet('hello');
    expect(errors[0].constraints?.isStellarPublicKey).toBeDefined();
  });

  it('fails for a Stellar secret key (starts with S)', async () => {
    const errors = await validateWallet(
      'SAYNCJDKOD6DMRXKCLJWO4FVQAWRRABZ5CO7M7EXAEOIHGXPYRKXAQUC',
    );
    expect(errors[0].constraints?.isStellarPublicKey).toBeDefined();
  });

  it('fails for an empty string', async () => {
    const errors = await validateWallet('');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for a key that is one character short', async () => {
    const errors = await validateWallet(VALID_KEY.slice(0, 55));
    expect(errors[0].constraints?.isStellarPublicKey).toBeDefined();
  });
});
