import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';
import { Request } from 'express';

const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class StellarWalletGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    const account = request.headers['x-stellar-account'] as string | undefined;
    const signatureB64 = request.headers['x-stellar-signature'] as
      string | undefined;
    const timestamp = request.headers['x-stellar-timestamp'] as
      string | undefined;

    if (!account || !signatureB64 || !timestamp) {
      throw new UnauthorizedException({
        code: 'STELLAR_AUTH_MISSING',
        message:
          'x-stellar-account, x-stellar-signature, and x-stellar-timestamp headers are required.',
      });
    }

    const ts = Number(timestamp);
    if (
      Number.isNaN(ts) ||
      Math.abs(Date.now() - ts) > MAX_TIMESTAMP_DRIFT_MS
    ) {
      throw new UnauthorizedException({
        code: 'STELLAR_AUTH_REPLAY',
        message:
          'Timestamp is missing, invalid, or outside the 5-minute replay window.',
      });
    }

    let keypair: Keypair;
    try {
      keypair = Keypair.fromPublicKey(account);
    } catch {
      throw new UnauthorizedException({
        code: 'STELLAR_AUTH_INVALID_KEY',
        message: 'x-stellar-account is not a valid Stellar public key.',
      });
    }

    let signatureBytes: Buffer;
    try {
      signatureBytes = Buffer.from(signatureB64, 'base64');
    } catch {
      throw new UnauthorizedException({
        code: 'STELLAR_AUTH_INVALID_SIG',
        message: 'x-stellar-signature must be a valid base64-encoded string.',
      });
    }

    const message = Buffer.from(`${account}:${timestamp}`);
    const valid = keypair.verify(message, signatureBytes);

    if (!valid) {
      throw new UnauthorizedException({
        code: 'STELLAR_AUTH_SIG_MISMATCH',
        message: 'Signature verification failed.',
      });
    }

    (request as Request & { stellarAccount: string }).stellarAccount = account;
    return true;
  }
}
