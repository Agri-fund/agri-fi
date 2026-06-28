import {
  Injectable,
  Inject,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import axios from 'axios';
import { TransactionLog, TxStatus } from './entities/transaction-log.entity';
import { KmsService } from '../kms/kms.service';
import {
  Horizon,
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
  Asset,
  BASE_FEE,
  Memo,
  Transaction,
  Claimant,
} from '@stellar/stellar-sdk';
import BigNumber from 'bignumber.js';
import { RedisClientType } from 'redis';
import { createAsset } from './utils/asset-helper';

export const SEQUENCE_REDIS_CLIENT = 'SEQUENCE_REDIS_CLIENT';
const SEQUENCE_CACHE_TTL = 5; // seconds


export interface InvestorShare {
  walletAddress: string;
  tokenAmount: number;
  totalTokens: number;
}

export interface SignatureValidationResult {
  valid: boolean;
  /** Public key that was checked */
  publicKey: string;
  /** Number of signatures found on the envelope */
  signatureCount: number;
  /** Index of the matching signature, or -1 if none matched */
  matchedSignatureIndex: number;
  error?: string;
}

@Injectable()
export class StellarService implements OnModuleInit, OnModuleDestroy {
  private readonly server: Horizon.Server;
  private readonly networkPassphrase: string;
  private readonly platformKeypair: Keypair;
  private readonly usdcAsset: Asset;
  private readonly localSequenceCache: Map<string, { seq: string; expiresAt: number }>;
  private readonly enableSequenceCache: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
    @InjectRepository(TransactionLog)
    private readonly txLogRepo: Repository<TransactionLog>,
    private readonly kmsService: KmsService,
    @Optional()
    @Inject(SEQUENCE_REDIS_CLIENT)
    private readonly sequenceRedis: RedisClientType | null,
  ) {
    this.localSequenceCache = new Map();
    this.enableSequenceCache = true;
    this.logger.setContext(StellarService.name);

    const horizonUrl = config.get<string>(
      'STELLAR_HORIZON_URL',
      'https://horizon-testnet.stellar.org',
    );
    const network = config.get<string>('STELLAR_NETWORK', 'testnet');

    this.server = new Horizon.Server(horizonUrl, { timeout: 30000 });
    this.networkPassphrase =
      network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

    const platformSecret = config.get<string>('STELLAR_PLATFORM_SECRET', '');
    if (!platformSecret && process.env.NODE_ENV !== 'test') {
      throw new Error(
        'STELLAR_PLATFORM_SECRET is required in production and development environments',
      );
    }
    if (!platformSecret && process.env.NODE_ENV === 'test') {
      this.logger.warn(
        'STELLAR_PLATFORM_SECRET is not set; using a random in-memory platform keypair. Network-dependent Stellar tests should be skipped unless a funded testnet secret is configured.',
      );
    }
    this.platformKeypair = platformSecret
      ? Keypair.fromSecret(platformSecret)
      : Keypair.random();

    // Removed ENCRYPTION_KEY validation as KMS handles encryption.
    // Ensure KMS_KEY_ID is set via environment.


    const usdcAssetCode = config.get<string>('USDC_ASSET_CODE', 'USDC');
    const usdcIssuer = config.get<string>('USDC_ISSUER', '');
    this.usdcAsset = usdcIssuer
      ? createAsset(usdcAssetCode, usdcIssuer)
      : Asset.native(); // fallback to XLM only if issuer not configured

    this.logger.info(
      {
        network,
        horizonUrl,
        usdcAssetCode,
        usdcIssuer: usdcIssuer || 'NOT_SET',
      },
      `StellarService initialized on ${network}`,
    );
  }

  private async fundAccountWithFriendbot(publicKey: string): Promise<void> {
    const isDevelopmentEnv =
      process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev';
    const isTestnet = this.networkPassphrase === Networks.TESTNET;

    if (!isDevelopmentEnv || !isTestnet) {
      return;
    }

    const friendbotUrl = `https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await axios.get(friendbotUrl, { timeout: 10000 });
        this.logger.info({ publicKey }, 'Funded Stellar account via Friendbot');
        return;
      } catch (error: any) {
        const status = error?.response?.status;
        const isRateLimited = status === 429 || status === 503;

        if (attempt < maxAttempts && isRateLimited) {
          this.logger.warn(
            { publicKey, attempt, status, message: error?.message },
            'Friendbot rate limited, retrying funding request',
          );
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          continue;
        }

        this.logger.warn(
          { publicKey, attempt, status, message: error?.message },
          'Friendbot funding request failed; continuing without funding',
        );
        return;
      }
    }
  async onModuleInit(): Promise<void> {
    await this.connectRedis();
  }

  async onModuleDestroy(): Promise<void> {
    this.localSequenceCache.clear();
    if (this.sequenceRedis?.isOpen) {
      await this.sequenceRedis.quit();
    }
  }

  private async connectRedis(): Promise<void> {
    if (!this.sequenceRedis || this.sequenceRedis.isOpen) {
      return;
    }
    await this.sequenceRedis.connect();
  }

  private cacheSeqKey(publicKey: string): string {
    return `stellar:seq:${publicKey}`;
  }

  private async getCachedSequence(publicKey: string): Promise<string | null> {
    const now = Date.now();
    const local = this.localSequenceCache.get(publicKey);
    if (local && now < local.expiresAt) {
      return local.seq;
    }
    this.localSequenceCache.delete(publicKey);

    if (this.sequenceRedis) {
      try {
        const raw = await this.sequenceRedis.get(this.cacheSeqKey(publicKey));
        if (raw) {
          const parsed = JSON.parse(raw);
          this.localSequenceCache.set(publicKey, {
            seq: parsed.seq,
            expiresAt: now + SEQUENCE_CACHE_TTL * 1000,
          });
          return parsed.seq;
        }
      } catch {
        // Redis failure — fall back to local
      }
    }
    return null;
  }

  private async setCachedSequence(publicKey: string, seq: string): Promise<void> {
    const expiresAt = Date.now() + SEQUENCE_CACHE_TTL * 1000;
    this.localSequenceCache.set(publicKey, { seq, expiresAt });

    if (this.sequenceRedis) {
      try {
        await this.sequenceRedis.setEx(
          this.cacheSeqKey(publicKey),
          SEQUENCE_CACHE_TTL,
          JSON.stringify({ seq }),
        );
      } catch {
        // Redis failure — local cache is sufficient
      }
    }
  }

  private async invalidateCachedSequence(publicKey: string): Promise<void> {
    this.localSequenceCache.delete(publicKey);
    if (this.sequenceRedis) {
      try {
        await this.sequenceRedis.del(this.cacheSeqKey(publicKey));
      } catch {
        // best-effort
      }
    }
  }

  /**
   * Loads a Stellar account, preferring cached sequence numbers.
   */
  async loadAccountCached(publicKey: string): Promise<Horizon.AccountResponse> {
    const cachedSeq = await this.getCachedSequence(publicKey);
    if (cachedSeq) {
      try {
        const account = await this.server.loadAccount(publicKey);
        const liveSeq = account.sequenceNumber();
        if (liveSeq === cachedSeq) {
          return account;
        }
        await this.setCachedSequence(publicKey, liveSeq);
        return account;
      } catch {
        // Fall through to fresh load
      }
    }

    const account = await this.server.loadAccount(publicKey);
    await this.setCachedSequence(publicKey, account.sequenceNumber());
    return account;
  }

  /**
   * Increments the locally-cached sequence number so subsequent pooled
   * transactions can use the next sequence without re-fetching from Horizon.
   */
  private async incrementLocalSequence(publicKey: string): Promise<void> {
    const current = this.localSequenceCache.get(publicKey);
    if (current) {
      const nextSeq = (BigInt(current.seq) + 1n).toString();
      await this.setCachedSequence(publicKey, nextSeq);
    }
  }

  /**
   * Validates a transaction envelope XDR before submission.
   * Asserts only expected operations are present and destination
   * addresses match active deal escrows.
   */
  async validateTransactionXdr(
    signedXdr: string,
    allowedOpTypes: string[] = ['payment', 'changeTrust'],
    allowedDestinations?: string[],
  ): Promise<{ valid: boolean; reason?: string }> {
    let tx: Transaction;
    try {
      tx = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);
    } catch {
      return { valid: false, reason: 'Invalid XDR: could not decode transaction' };
    }

    const opTypeMap: Record<number, string> = {
      1: 'createAccount',
      2: 'payment',
      3: 'pathPaymentStrictReceive',
      4: 'manageSellOffer',
      5: 'createPassiveSellOffer',
      6: 'setOptions',
      7: 'changeTrust',
      8: 'allowTrust',
      9: 'accountMerge',
      10: 'inflation',
      11: 'manageData',
      12: 'bumpSequence',
      13: 'manageBuyOffer',
      14: 'pathPaymentStrictSend',
      15: 'claimClaimableBalance',
      16: 'beginSponsoringFutureReserves',
      17: 'endSponsoringFutureReserves',
      18: 'revokeSponsorship',
      19: 'clawback',
      20: 'clawbackClaimableBalance',
      21: 'setTrustLineFlags',
      22: 'liquidityPoolDeposit',
      23: 'liquidityPoolWithdraw',
    };

    const allowedSet = new Set(allowedOpTypes.map((t) => t.toLowerCase()));

    for (const op of tx.operations) {
      const opName = opTypeMap[op.type] ?? `unknown_${op.type}`;
      if (!allowedSet.has(opName)) {
        return {
          valid: false,
          reason: `Operation type '${opName}' is not allowed. Allowed: ${allowedOpTypes.join(', ')}`,
        };
      }

      if (
        allowedDestinations &&
        (opName === 'payment' || opName === 'createAccount')
      ) {
        const dest = (op as any).destination;
        if (dest && !allowedDestinations.includes(dest)) {
          return {
            valid: false,
            reason: `Destination ${dest} is not in the allowed escrow list`,
          };
        }
      }
    }

    return { valid: true };
  }

  /**
   * Persists a transaction audit record. Never throws — failures are logged only.
   */
  async saveLog(entry: {
    userId?: string;
    dealId?: string;
    txHash?: string;
    xdrBody?: string;
    status: TxStatus;
    errorCode?: string;
  }): Promise<void> {
    try {
      await this.txLogRepo.save(this.txLogRepo.create(entry));
    } catch (err: any) {
      this.logger.error({ err }, 'Failed to persist transaction log');
    }
  }

  /**
   * Creates a new Stellar escrow account funded with minimum XLM balance.
   * Also establishes a USDC trustline so the escrow can receive USDC.
   * Returns the keypair for the escrow account.
   */
  async createEscrowAccount(
    tradeDealId: string,
  ): Promise<{ publicKey: string; secretKey: string }> {
    const escrowKeypair = Keypair.random();
    await this.fundAccountWithFriendbot(escrowKeypair.publicKey());

    const platformAccount = await this.server.loadAccount(
      this.platformKeypair.publicKey(),
    );

    // Fund escrow with enough XLM for base reserve + USDC trustline (2 XLM base + 0.5 per trustline)
    const tx = new TransactionBuilder(platformAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.createAccount({
          destination: escrowKeypair.publicKey(),
          startingBalance: '3', // 2 XLM base reserve + 0.5 for USDC trustline + buffer
        }),
      )
      .addMemo(Memo.text(`escrow:${tradeDealId.slice(0, 20)}`))
      .setTimeout(30)
      .build();

    tx.sign(this.platformKeypair);
    await this.submitWithRetry(tx);

    // Establish USDC trustline on the escrow account (skip if USDC issuer not configured)
    if (!this.usdcAsset.isNative()) {
      const escrowAccount = await this.server.loadAccount(
        escrowKeypair.publicKey(),
      );
      const trustlineTx = new TransactionBuilder(escrowAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          Operation.changeTrust({
            asset: this.usdcAsset,
          }),
        )
        .setTimeout(30)
        .build();

      trustlineTx.sign(escrowKeypair);
      await this.submitWithRetry(trustlineTx);
    }

    this.logger.info(
      {
        tradeDealId,
        escrowPublicKey: escrowKeypair.publicKey(),
        memo: `escrow:${tradeDealId.slice(0, 20)}`,
        usdcTrustline: !this.usdcAsset.isNative(),
      },
      'Escrow account created successfully',
    );

    return {
      publicKey: escrowKeypair.publicKey(),
      secretKey: escrowKeypair.secret(),
    };
  }

  /**
   * Issues Trade_Tokens for a deal.
   * - Generates a fresh issuer keypair
   * - Escrow account establishes a trustline for the asset
   * - Issuer mints token_count tokens to the escrow account
   * Returns the Stellar transaction ID of the payment (mint) transaction.
   */
  async issueTradeToken(
    assetCode: string,
    escrowPublicKey: string,
    escrowSecret: string,
    tokenCount: number,
  ): Promise<{ txId: string; issuerPublicKey: string; issuerSecret: string }> {
    // Generate a fresh issuer keypair for this deal
    const issuerKeypair = Keypair.random();
    await this.fundAccountWithFriendbot(issuerKeypair.publicKey());

    // Fund the issuer account via platform account
    const platformAccount = await this.server.loadAccount(
      this.platformKeypair.publicKey(),
    );

    const fundIssuerTx = new TransactionBuilder(platformAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.createAccount({
          destination: issuerKeypair.publicKey(),
          startingBalance: '1.5',
        }),
      )
      .addOperation(
        Operation.setOptions({
          source: issuerKeypair.publicKey(),
          // AuthRevocableFlag (2) | AuthClawbackEnabledFlag (8)
          setFlags: 10 as any,
        }),
      )
      .setTimeout(30)
      .build();

    fundIssuerTx.sign(this.platformKeypair, issuerKeypair);
    await this.submitWithRetry(fundIssuerTx);

    const tradeAsset = createAsset(assetCode, issuerKeypair.publicKey());

    // Escrow account establishes trustline for the asset
    const escrowAccount = await this.server.loadAccount(escrowPublicKey);
    const escrowKeypair = Keypair.fromSecret(escrowSecret);

    const trustlineTx = new TransactionBuilder(escrowAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.changeTrust({
          asset: tradeAsset,
          limit: tokenCount.toString(),
        }),
      )
      .setTimeout(30)
      .build();

    trustlineTx.sign(escrowKeypair);
    await this.submitWithRetry(trustlineTx);

    // Issuer mints tokens to escrow account
    const issuerAccount = await this.server.loadAccount(
      issuerKeypair.publicKey(),
    );

    const mintTx = new TransactionBuilder(issuerAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: escrowPublicKey,
          asset: tradeAsset,
          amount: tokenCount.toString(),
        }),
      )
      .setTimeout(30)
      .build();

    mintTx.sign(issuerKeypair);
    const mintResult = await this.submitWithRetry(mintTx);

    const txId = (mintResult as any).hash as string;
    this.logger.info(
      {
        assetCode,
        txId,
        issuerPublicKey: issuerKeypair.publicKey(),
        escrowPublicKey,
        tokenCount,
      },
      'Trade token issued successfully',
    );

    return {
      txId,
      issuerPublicKey: issuerKeypair.publicKey(),
      issuerSecret: issuerKeypair.secret(),
    };
  }

  /**
   * Funds the escrow account from an investor wallet using USDC.
   * The escrow account must already hold a USDC trustline.
   * Returns the Stellar transaction ID.
   */
  async fundEscrow(
    escrowPublicKey: string,
    investorWallet: string,
    amountUSD: string,
    encryptedEscrowSecret?: string,
    assetCode?: string,
    tokenAmount?: number,
  ): Promise<string> {
    // Verify the payment asset is USDC (not XLM)
    const paymentAsset = this.usdcAsset;
    if (paymentAsset.isNative()) {
      this.logger.warn(
        { escrowPublicKey },
        'USDC_ISSUER not configured — falling back to XLM. Set USDC_ASSET_CODE and USDC_ISSUER in .env',
      );
    }

    const investorAccount = await this.server.loadAccount(investorWallet);

    const tx = new TransactionBuilder(investorAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: escrowPublicKey,
          asset: paymentAsset,
          amount: amountUSD,
        }),
      )
      .setTimeout(30)
      .build();

    // Note: in production the investor signs this via their wallet (Freighter/Albedo)
    // For backend-initiated flows, we'd need the investor's secret — omitted here
    const result = await this.submitWithRetry(tx);
    const paymentTxId = (result as any).hash as string;

    // If escrow secret and asset info provided, transfer Trade_Tokens to investor
    if (encryptedEscrowSecret && assetCode && tokenAmount !== undefined) {
      const escrowSecret = this.decryptSecret(encryptedEscrowSecret);
      await this.transferTradeTokens(
        escrowSecret,
        escrowPublicKey,
        investorWallet,
        assetCode,
        tokenAmount,
      );
    }

    return paymentTxId;
  }

  /**
   * Transfers Trade_Tokens from escrow account to investor wallet.
   */
  public async transferTradeTokens(
    escrowSecret: string,
    escrowPublicKey: string,
    investorWallet: string,
    assetCode: string,
    tokenAmount: number,
  ): Promise<string> {
    const escrowKeypair = Keypair.fromSecret(escrowSecret);
    const escrowAccount = await this.server.loadAccount(escrowPublicKey);

    const tradeToken = createAsset(assetCode, escrowPublicKey);

    const tx = new TransactionBuilder(escrowAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: investorWallet,
          asset: tradeToken,
          amount: tokenAmount.toFixed(7),
        }),
      )
      .setTimeout(30)
      .build();

    tx.sign(escrowKeypair);

    const result = await this.submitWithRetry(tx);
    const txId = (result as any).hash as string;
    this.logger.info(
      {
        tokenAmount,
        assetCode,
        investorWallet,
        txId,
      },
      `Transferred ${tokenAmount} ${assetCode} tokens to investor`,
    );
    return txId;
  }

  /**
   * Encrypts a secret key using AES-256-CBC with the ENCRYPTION_KEY env var.
   */
  async encryptSecret(secret: string): Promise<string> {
    return this.kmsService.encrypt(secret);
  }

  /**
   * Decrypts a secret key encrypted by encryptSecret().
   */
  async decryptSecret(encryptedSecret: string): string {
    return this.kmsService.decrypt(encryptedSecret);
  }

  /**
   * Releases escrow funds: farmer (98%), investors (proportional), platform (2%).
   * Uses BigNumber.js for all amount conversions to avoid precision loss.
   * For investors without a USDC trustline, creates a claimable balance instead
   * of a payment so funds remain available for later claiming.
   * Returns an array of transaction IDs for each batch.
   */
  async releaseEscrow(
    escrowSecret: string,
    farmerWallet: string,
    investorShares: InvestorShare[],
    platformWallet: string,
    totalValue: number,
  ): Promise<string[]> {
    const escrowKeypair = Keypair.fromSecret(escrowSecret);

    // Convert to stroops using BigNumber (1 XLM = 10^7 stroops)
    const totalValueBN = new BigNumber(totalValue);
    const totalStroopsBN = totalValueBN.multipliedBy(1e7);

    if (totalStroopsBN.isLessThanOrEqualTo(0)) {
      throw new Error('Invalid totalValue');
    }

    // Calculate platform + farmer using BigNumber
    const platformStroopsBN = totalStroopsBN.multipliedBy(0.02).integerValue(
      BigNumber.ROUND_FLOOR,
    );
    const farmerStroopsBN = totalStroopsBN.multipliedBy(0.98).integerValue(
      BigNumber.ROUND_FLOOR,
    );

    const totalStroops = totalStroopsBN.toNumber();
    const platformStroops = platformStroopsBN.toNumber();
    const farmerStroops = farmerStroopsBN.toNumber();

    // Compute total tokens safely
    const totalTokens = investorShares.reduce(
      (sum, s) => sum + s.tokenAmount,
      0,
    );

    if (totalTokens <= 0) {
      throw new Error('Invalid investor token distribution');
    }

    // Pre-check which investors have a USDC trustline for claimable balance logic
    const trustlineResults = await Promise.allSettled(
      investorShares.map((share) =>
        this.server
          .loadAccount(share.walletAddress)
          .then((acc) => this.hasTrustline(acc, this.usdcAsset)),
      ),
    );
    const hasUsdcTrustline = investorShares.map(
      (_, i) =>
        trustlineResults[i].status === 'fulfilled' &&
        (trustlineResults[i] as PromiseFulfilledResult<boolean>).value,
    );

    const BATCH_SIZE = 98;
    const txIds: string[] = [];
    let distributedToInvestors = 0;
    const batchCount = Math.max(
      1,
      Math.ceil(investorShares.length / BATCH_SIZE),
    );

    // Track claimable balances for database logging
    const claimableInvestors: Array<{
      walletAddress: string;
      amount: string;
      txHash?: string;
    }> = [];

    for (let batchIdx = 0; batchIdx < batchCount; batchIdx++) {
      const batchStart = batchIdx * BATCH_SIZE;
      const batch = investorShares.slice(batchStart, batchStart + BATCH_SIZE);

      const batchAccount = this.enableSequenceCache
        ? await this.loadAccountCached(escrowKeypair.publicKey())
        : await this.server.loadAccount(escrowKeypair.publicKey());
      const txBuilder = new TransactionBuilder(batchAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      });

      if (batchIdx === 0) {
        txBuilder.addOperation(
          Operation.payment({
            destination: farmerWallet,
            asset: this.usdcAsset,
            amount: new BigNumber(farmerStroops)
              .dividedBy(1e7)
              .toFixed(7),
          }),
        );
      }

      batch.forEach((share, localIdx) => {
        const globalIdx = batchStart + localIdx;
        let shareStroops = Math.floor(
          (share.tokenAmount / totalTokens) * totalStroops,
        );

        if (globalIdx === investorShares.length - 1) {
          shareStroops =
            totalStroops -
            farmerStroops -
            platformStroops -
            distributedToInvestors;
        }

        distributedToInvestors += shareStroops;

        const shareAmount = new BigNumber(shareStroops)
          .dividedBy(1e7)
          .toFixed(7);
        if (parseFloat(shareAmount) > 0) {
          if (hasUsdcTrustline[globalIdx]) {
            txBuilder.addOperation(
              Operation.payment({
                destination: share.walletAddress,
                asset: this.usdcAsset,
                amount: shareAmount,
              }),
            );
          } else {
            // Investor lacks USDC trustline — create claimable balance
            txBuilder.addOperation(
              Operation.createClaimableBalance({
                asset: this.usdcAsset,
                amount: shareAmount,
                claimants: [
                  new Claimant(
                    share.walletAddress,
                    Claimant.predicateUnconditional(),
                  ),
                ],
              }),
            );
            claimableInvestors.push({
              walletAddress: share.walletAddress,
              amount: shareAmount,
            });
          }
        }
      });

      if (batchIdx === batchCount - 1) {
        txBuilder.addOperation(
          Operation.payment({
            destination: platformWallet,
            asset: this.usdcAsset,
            amount: new BigNumber(platformStroops)
              .dividedBy(1e7)
              .toFixed(7),
          }),
        );
      }

      const tx = txBuilder.setTimeout(30).build();
      tx.sign(escrowKeypair);

      // Increment local sequence for next batch
      if (this.enableSequenceCache) {
        await this.incrementLocalSequence(escrowKeypair.publicKey());
      }

      try {
        const result = await this.submitWithRetry(tx);
        const txHash = (result as any).hash as string;
        txIds.push(txHash);

        // Log any claimable balances created in this batch
        const batchClaimable = claimableInvestors.filter(
          (ci) =>
            !ci.txHash &&
            batch.some((s) => s.walletAddress === ci.walletAddress),
        );
        for (const ci of batchClaimable) {
          ci.txHash = txHash;
          await this.saveLog({
            dealId: ci.walletAddress,
            txHash,
            status: TxStatus.PENDING_CLAIM,
          });
        }
      } catch (err: any) {
        this.logger.error(
          { batchIdx, totalBatches: batchCount },
          `Escrow release failed at batch ${batchIdx}: ${err.message}`,
        );
        throw new Error(`Escrow release failed: ${err.message}`);
      }
    }

    this.logger.info(
      { txIds, claimableCount: claimableInvestors.length },
      'Escrow released successfully',
    );
    return txIds;
  }

  /**
   * Records a document's SHA-256 hash on the Stellar ledger using Memo.Hash.
   * This serves as a tamper-proof "Proof of Existence".
   */
  async recordDocumentHash(
    docHashHex: string,
    signerSecret: string,
  ): Promise<string> {
    const signerKeypair = Keypair.fromSecret(signerSecret);
    const account = await this.server.loadAccount(signerKeypair.publicKey());

    // Create a transaction with the document hash in the Memo
    // We use a minimal self-payment as the carrier for the memo
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: signerKeypair.publicKey(),
          asset: Asset.native(),
          amount: '0.000001',
        }),
      )
      .addMemo(Memo.hash(docHashHex))
      .setTimeout(30)
      .build();

    tx.sign(signerKeypair);
    const result = await this.submitWithRetry(tx);

    const txId = (result as any).hash as string;
    return txId;
  }

  /**
   * Merges an empty escrow or issuer account back to the platform account.
   * Zeroes out any remaining custom tokens (burns them by sending to issuer)
   * and USDC (sends to platform), then removes trustlines before merging.
   */
  async closeAccount(
    publicKey: string,
    secretKey: string,
    destination: string,
  ): Promise<string> {
    const keypair = Keypair.fromSecret(secretKey);
    const account = await this.server.loadAccount(publicKey);

    const assetsWithBalance = account.balances
      .filter((b) => b.asset_type !== 'native' && parseFloat(b.balance) > 0)
      .map((b: any) => b.asset_code || b.asset_type);

    if (assetsWithBalance.length > 0) {
      throw new Error(
        `Cannot merge account: holds positive balance of ${assetsWithBalance.join(', ')}`,
      );
    }

    const txBuilder = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    });

    for (const balance of account.balances) {
      if (balance.asset_type !== 'native') {
        const asset =
          balance.asset_type === 'credit_alphanum4' ||
          balance.asset_type === 'credit_alphanum12'
            ? createAsset(balance.asset_code, balance.asset_issuer)
            : undefined;

        if (asset) {
          // Remove trustline
          txBuilder.addOperation(
            Operation.changeTrust({
              asset,
              limit: '0',
            }),
          );
        }
      }
    }

    txBuilder.addOperation(
      Operation.accountMerge({
        destination,
      }),
    );

    const tx = txBuilder.setTimeout(30).build();
    tx.sign(keypair);

    try {
      const result = await this.submitWithRetry(tx);
      const txId = (result as any).hash as string;
      this.logger.info(
        { publicKey, destination, txId },
        'Account closed and merged successfully',
      );
      return txId;
    } catch (err: any) {
      this.logger.error(
        `Account merge failed for ${publicKey}: ${err.message}`,
        err.stack,
      );
      throw new Error(`Account merge failed: ${err.message}`);
    }
  }

  /**
   * Records an arbitrary memo on Stellar (used for milestone anchoring and document hashes).
   * Returns the transaction ID.
   */
  async recordMemo(
    memo: string,
    signerSecret: string,
    memoType: 'text' | 'hash' = 'text',
  ): Promise<string> {
    const signerKeypair = Keypair.fromSecret(signerSecret);
    const account = await this.server.loadAccount(signerKeypair.publicKey());

    let stellarMemo: Memo;

    if (memoType === 'hash') {
      const hash = createHash('sha256').update(memo).digest();
      stellarMemo = Memo.hash(hash.toString('hex'));
    } else {
      // Stellar memo text is limited to 28 bytes; truncate if needed
      const memoText = memo.slice(0, 28);
      stellarMemo = Memo.text(memoText);
    }

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: signerKeypair.publicKey(), // self-payment as anchor
          asset: Asset.native(), // minimal XLM used only as anchor vehicle
          amount: '0.0000001',
        }),
      )
      .addMemo(stellarMemo)
      .setTimeout(30)
      .build();

    tx.sign(signerKeypair);
    const result = await this.submitWithRetry(tx);
    return (result as any).hash as string;
  }

  /**
   * Validates that an XDR transaction envelope carries a valid Ed25519 signature
   * from the given public key, without submitting to the network.
   *
   * Steps:
   *  1. Decode the XDR envelope and compute the transaction hash (the actual
   *     payload that signers sign, which includes the network passphrase).
   *  2. Derive the 4-byte key hint from the supplied public key.
   *  3. Walk the envelope's decorator signatures; find the one whose hint matches
   *     and cryptographically verify it with Keypair.verify().
   *
   * Returns a SignatureValidationResult so callers can surface precise errors to
   * the user without an unnecessary round-trip to Horizon.
   */
  validateTransactionSignatures(
    signedXdr: string,
    expectedPublicKey: string,
  ): SignatureValidationResult {
    const base: Omit<SignatureValidationResult, 'valid'> = {
      publicKey: expectedPublicKey,
      signatureCount: 0,
      matchedSignatureIndex: -1,
    };

    let keypair: Keypair;
    try {
      keypair = Keypair.fromPublicKey(expectedPublicKey);
    } catch {
      return {
        ...base,
        valid: false,
        error: `Invalid public key: "${expectedPublicKey}" is not a valid Stellar ed25519 public key.`,
      };
    }

    let tx: ReturnType<typeof TransactionBuilder.fromXDR>;
    try {
      tx = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);
    } catch {
      return {
        ...base,
        valid: false,
        error: 'Failed to parse XDR envelope. Ensure the transaction was built for the correct network.',
      };
    }

    const signatures = tx.signatures;
    base.signatureCount = signatures.length;

    if (signatures.length === 0) {
      return {
        ...base,
        valid: false,
        error: 'Transaction envelope contains no signatures.',
      };
    }

    // The payload that was signed: SHA-256(network_passphrase_hash || tx_hash_prefix || tx_body)
    const txHash = tx.hash();
    const expectedHint = keypair.signatureHint();

    for (let i = 0; i < signatures.length; i++) {
      const decoratedSig = signatures[i];
      const hint = decoratedSig.hint();

      // Quick hint check before expensive verify
      if (!hint.equals(expectedHint)) {
        continue;
      }

      const signatureBytes = decoratedSig.signature();
      const isValid = keypair.verify(txHash, signatureBytes);

      if (isValid) {
        this.logger.info(
          { publicKey: expectedPublicKey, signatureIndex: i },
          'Transaction signature validated successfully',
        );
        return {
          ...base,
          valid: true,
          matchedSignatureIndex: i,
        };
      }

      // Hint matched but bytes failed — report immediately
      return {
        ...base,
        valid: false,
        matchedSignatureIndex: i,
        error: `Signature at index ${i} has a matching hint for key ${expectedPublicKey} but failed cryptographic verification. The transaction may have been tampered with.`,
      };
    }

    return {
      ...base,
      valid: false,
      error: `No signature found for public key ${expectedPublicKey}. The transaction has ${signatures.length} signature(s) but none match this key's hint.`,
    };
  }

  /**
   * Checks whether an account already has a trustline for the given asset.
   */
  private async hasTrustline(
    account: Horizon.AccountResponse,
    asset: Asset,
  ): Promise<boolean> {
    return account.balances.some(
      (b: any) =>
        b.asset_type !== 'native' &&
        b.asset_code === asset.getCode() &&
        b.asset_issuer === asset.getIssuer(),
    );
  }

  /**
   * Calculates the minimum XLM reserve required for an account.
   * Formula: base_reserve = (2 + num_trustlines + num_signers) * 0.5 XLM
   */
  async getMinimumBalance(account: Horizon.AccountResponse): Promise<string> {
    const numTrustlines = account.balances.filter(
      (b: any) => b.asset_type !== 'native',
    ).length;
    const numSigners = account.signers ? account.signers.length : 1;
    const reserve = new BigNumber(2)
      .plus(numTrustlines)
      .plus(numSigners)
      .multipliedBy(0.5);
    return reserve.toFixed(7);
  }

  /**
   * Verifies an account's XLM balance exceeds the minimum base reserve
   * before sending transactions. Returns the balance and minimum required.
   */
  async checkMinimumReserve(
    publicKey: string,
  ): Promise<{
    sufficient: boolean;
    balance: string;
    minimumRequired: string;
  }> {
    const account = await this.server.loadAccount(publicKey);
    const xlmBalance =
      (
        account.balances.find(
          (b: any) => b.asset_type === 'native',
        ) as any
      )?.balance ?? '0';
    const minRequired = await this.getMinimumBalance(account);
    return {
      sufficient: new BigNumber(xlmBalance).gte(minRequired),
      balance: xlmBalance,
      minimumRequired: minRequired,
    };
  }

  /**
   * Creates an unsigned XDR transaction for an investment using USDC.
   * Prepends a changeTrust operation when the investor lacks a trustline.
   * Throws a descriptive error when the investor has insufficient XLM reserve.
   * The investor will sign this transaction to fund the escrow account.
   */
  async createInvestmentTransaction(
    investorWallet: string,
    escrowPublicKey: string,
    amountUSD: number,
    assetCode: string,
    tokenAmount: number,
    issuerPublicKey: string,
    complianceData?: Record<string, unknown>,
  ): Promise<string> {
    const investorAccount = await this.server.loadAccount(investorWallet);
    const tradeAsset = createAsset(assetCode, issuerPublicKey);

    const needsTrustline = !(await this.hasTrustline(
      investorAccount,
      tradeAsset,
    ));

    if (needsTrustline) {
      // Each trustline requires 0.5 XLM base reserve; ensure the investor can cover it
      const xlmBalance = parseFloat(
        (
          investorAccount.balances.find(
            (b: any) => b.asset_type === 'native',
          ) as any
        )?.balance ?? '0',
      );
      // Minimum spendable = existing subentries * 0.5 + 2 (base) + 0.5 (new trustline) + fee buffer
      const minRequired =
        (investorAccount.subentry_count + 1) * 0.5 + 2 + 0.001;
      if (xlmBalance < minRequired) {
        throw new Error(
          `Insufficient XLM balance for trustline base reserve. ` +
            `Need at least ${minRequired.toFixed(3)} XLM, have ${xlmBalance} XLM.`,
        );
      }
    }

    // Use USDC for stable USD-denominated payments
    const txBuilder = new TransactionBuilder(investorAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    });

    if (needsTrustline) {
      txBuilder.addOperation(Operation.changeTrust({ asset: tradeAsset }));
    }

    txBuilder
      .addOperation(
        Operation.payment({
          destination: escrowPublicKey,
          asset: this.usdcAsset,
          amount: amountUSD.toFixed(7),
        }),
      )
      .addMemo(Memo.text(`invest:${assetCode}:${tokenAmount}`))
      .setTimeout(300);

    this.addComplianceDataOperations(txBuilder, complianceData);

    return txBuilder.build().toXDR();
  }

  /**
   * Queries the Horizon path-finding endpoint (strictSendPaths) to discover
   * the best conversion route from sourceAsset to destAsset for a given amount.
   * Returns the intermediate path and the projected destination amount, or null
   * if no route exists.
   */
  async findPaymentPaths(
    sourceAsset: Asset,
    destAsset: Asset,
    amount: string,
  ): Promise<{ path: Asset[]; destAmount: string } | null> {
    const page = await this.server
      .strictSendPaths(sourceAsset, amount, [destAsset])
      .call();

    const record = page.records[0];
    if (!record) return null;

    return {
      path: record.path as unknown as Asset[],
      destAmount: record.destination_amount,
    };
  }

  /**
   * Creates an unsigned XDR transaction for an investment using a path payment.
   * Investors who do not hold USDC can pay with XLM (native) or a custom asset
   * (e.g. EURC). Horizon path finding automatically discovers the best conversion
   * route through the Stellar DEX.
   *
   * Builds a pathPaymentStrictSend operation so the investor defines the exact
   * send asset and amount, while the escrow receives the required USDC.
   *
   * @param investorWallet   Public key of the investor (transaction source)
   * @param escrowPublicKey  Escrow account that receives USDC
   * @param sourceAsset      Asset the investor will send (native XLM or custom)
   * @param sendAmount       Exact amount of sourceAsset to send
   * @param amountUSD        Required USDC amount the escrow must receive (destMin)
   * @param assetCode        Trade token asset code
   * @param tokenAmount      Number of trade tokens the investor receives
   * @param issuerPublicKey  Trade token issuer
   * @param complianceData   Optional FATF Travel Rule data
   * @returns                Unsigned base64 XDR for the investor to sign
   */
  async createPathPaymentInvestmentTransaction(
    investorWallet: string,
    escrowPublicKey: string,
    sourceAsset: Asset,
    sendAmount: string,
    amountUSD: number,
    assetCode: string,
    tokenAmount: number,
    issuerPublicKey: string,
    complianceData?: Record<string, unknown>,
  ): Promise<string> {
    const investorAccount = await this.server.loadAccount(investorWallet);
    const tradeAsset = createAsset(assetCode, issuerPublicKey);

    // Find best conversion path from sourceAsset to USDC
    const pathResult = await this.findPaymentPaths(
      sourceAsset,
      this.usdcAsset,
      sendAmount,
    );

    if (!pathResult) {
      throw new Error(
        `No path found from ${sourceAsset.getCode()} to USDC for ${sendAmount} ${sourceAsset.getCode()}. ` +
        'Ensure the Stellar DEX has sufficient liquidity for this conversion.',
      );
    }

    const needsTrustline = !(await this.hasTrustline(
      investorAccount,
      tradeAsset,
    ));

    if (needsTrustline) {
      const xlmBalance = parseFloat(
        (
          investorAccount.balances.find(
            (b: any) => b.asset_type === 'native',
          ) as any
        )?.balance ?? '0',
      );
      const minRequired =
        (investorAccount.subentry_count + 1) * 0.5 + 2 + 0.001;
      if (xlmBalance < minRequired) {
        throw new Error(
          `Insufficient XLM balance for trustline base reserve. ` +
          `Need at least ${minRequired.toFixed(3)} XLM, have ${xlmBalance} XLM.`,
        );
      }
    }

    const txBuilder = new TransactionBuilder(investorAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    });

    if (needsTrustline) {
      txBuilder.addOperation(Operation.changeTrust({ asset: tradeAsset }));
    }

    txBuilder
      .addOperation(
        Operation.pathPaymentStrictSend({
          sendAsset: sourceAsset,
          sendAmount,
          destination: escrowPublicKey,
          destAsset: this.usdcAsset,
          destMin: amountUSD.toFixed(7),
          path: pathResult.path,
        }),
      )
      .addMemo(Memo.text(`path:${assetCode}:${tokenAmount}`))
      .setTimeout(300);

    this.addComplianceDataOperations(txBuilder, complianceData);

    return txBuilder.build().toXDR();
  }

  /**
   * Creates an unsigned XDR transaction for a bulk investment.
   * Groups multiple USDC payment operations into a single transaction (max 100 ops).
   * This lets institutional investors fund multiple deals in one network call.
   */
  async createBulkInvestmentTransaction(
    investorWallet: string,
    investments: Array<{
      escrowPublicKey: string;
      amountUSD: number;
      assetCode: string;
      tokenAmount: number;
      issuerPublicKey?: string;
      complianceData?: Record<string, unknown>;
    }>,
  ): Promise<string> {
    const MAX_OPS = 100;
    if (investments.length === 0) {
      throw new Error('At least one investment is required');
    }
    if (investments.length > MAX_OPS) {
      throw new Error(
        `Bulk transaction cannot exceed ${MAX_OPS} operations. Received ${investments.length}.`,
      );
    }

    const investorAccount = await this.server.loadAccount(investorWallet);

    // Group investments by asset to check trustlines
    const uniqueAssets = new Map<string, Asset>();
    for (const inv of investments) {
      if (inv.issuerPublicKey) {
        const key = `${inv.assetCode}:${inv.issuerPublicKey}`;
        if (!uniqueAssets.has(key)) {
          uniqueAssets.set(
            key,
            createAsset(inv.assetCode, inv.issuerPublicKey),
          );
        }
      }
    }

    // Check trustlines for each unique asset
    const missingTrustlines: Asset[] = [];
    for (const asset of uniqueAssets.values()) {
      const hasTrustline = await this.hasTrustline(investorAccount, asset);
      if (!hasTrustline) {
        missingTrustlines.push(asset);
      }
    }

    // Check XLM reserve for missing trustlines
    if (missingTrustlines.length > 0) {
      const xlmBalance = parseFloat(
        (
          investorAccount.balances.find(
            (b: any) => b.asset_type === 'native',
          ) as any
        )?.balance ?? '0',
      );
      // Each new trustline requires 0.5 XLM base reserve
      const minRequired =
        (investorAccount.subentry_count + missingTrustlines.length) * 0.5 +
        2 +
        0.001 * missingTrustlines.length;
      if (xlmBalance < minRequired) {
        throw new Error(
          `Insufficient XLM balance for trustline base reserves. ` +
            `Need at least ${minRequired.toFixed(3)} XLM for ${missingTrustlines.length} new trustline(s), have ${xlmBalance} XLM.`,
        );
      }
    }

    // Calculate total operations: payments + compliance data + trustlines
    const totalComplianceOps = investments.reduce(
      (count, inv) => count + (inv.complianceData ? 4 : 0),
      0,
    );
    const totalOps =
      investments.length + totalComplianceOps + missingTrustlines.length;

    if (totalOps > MAX_OPS) {
      throw new Error(
        `Bulk transaction cannot exceed ${MAX_OPS} operations. ` +
          `Received ${investments.length} payments + ${totalComplianceOps} compliance ops + ${missingTrustlines.length} trustline ops = ${totalOps} total.`,
      );
    }

    // Each operation costs BASE_FEE stroops; multiply by total operations
    const feePerOp = parseInt(BASE_FEE, 10);
    const totalFee = (feePerOp * totalOps).toString();

    const txBuilder = new TransactionBuilder(investorAccount, {
      fee: totalFee,
      networkPassphrase: this.networkPassphrase,
    });

    // Add trustline operations first
    for (const asset of missingTrustlines) {
      txBuilder.addOperation(Operation.changeTrust({ asset }));
    }

    // Add payment operations
    for (const inv of investments) {
      txBuilder.addOperation(
        Operation.payment({
          destination: inv.escrowPublicKey,
          asset: this.usdcAsset,
          amount: inv.amountUSD.toFixed(7),
        }),
      );
      this.addComplianceDataOperations(txBuilder, inv.complianceData);
    }

    // Build a single memo summarising the bulk (max 28 bytes)
    txBuilder.addMemo(Memo.text(`bulk:${investments.length}deals`));
    txBuilder.setTimeout(300); // 5 minutes for wallet signing

    const tx = txBuilder.build();

    this.logger.info(
      {
        investorWallet,
        dealCount: investments.length,
        totalUsd: investments.reduce((s, i) => s + i.amountUSD, 0),
        missingTrustlines: missingTrustlines.length,
        totalOps,
        totalFee,
      },
      'Bulk investment transaction built',
    );

    return tx.toXDR();
  }

  private addComplianceDataOperations(
    txBuilder: TransactionBuilder,
    complianceData?: Record<string, unknown>,
  ): void {
    if (!complianceData) return;

    const encoded = Buffer.from(JSON.stringify(complianceData)).toString(
      'base64',
    );
    const chunks = encoded.match(/.{1,64}/g) ?? [];

    chunks.slice(0, 4).forEach((chunk, index) => {
      txBuilder.addOperation(
        Operation.manageData({
          name: `fatf_${index + 1}`,
          value: chunk,
        }),
      );
    });
  }

  /**
   * Creates a manageSellOffer transaction for a trade token on the Stellar DEX.
   * Investors can use this to list their token shares for sale on the secondary market.
   * Returns an unsigned XDR that the investor must sign with their wallet.
   */
  async createSellOfferTransaction(
    sellerWallet: string,
    tradeTokenCode: string,
    tradeTokenIssuer: string,
    tokenAmount: number,
    pricePerToken: string,
    offerId = 0, // 0 = new offer; non-zero = update/cancel existing offer
  ): Promise<string> {
    const sellerAccount = await this.server.loadAccount(sellerWallet);
    const tradeAsset = createAsset(tradeTokenCode, tradeTokenIssuer);

    const tx = new TransactionBuilder(sellerAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.manageSellOffer({
          selling: tradeAsset,
          buying: this.usdcAsset,
          amount: tokenAmount.toFixed(7),
          price: pricePerToken,
          offerId,
        }),
      )
      .addMemo(Memo.text(`sell:${tradeTokenCode}`))
      .setTimeout(300)
      .build();

    this.logger.info(
      {
        sellerWallet,
        tradeTokenCode,
        tradeTokenIssuer,
        tokenAmount,
        pricePerToken,
        offerId,
      },
      'Sell offer transaction built',
    );

    return tx.toXDR();
  }

  /**
   * Fetches active DEX sell offers for a given trade token.
   * Used to display the order book on the deal details page.
   */
  async getActiveOffersForToken(
    tradeTokenCode: string,
    tradeTokenIssuer: string,
  ): Promise<
    Array<{
      offerId: string;
      seller: string;
      amount: string;
      price: string;
    }>
  > {
    const tradeAsset = createAsset(tradeTokenCode, tradeTokenIssuer);

    const offersPage = await this.server
      .offers()
      .selling(tradeAsset)
      .limit(50)
      .call();

    return offersPage.records.map((offer: any) => ({
      offerId: offer.id,
      seller: offer.seller,
      amount: offer.amount,
      price: offer.price,
    }));
  }

  /**
   * Fetches active DEX buy offers for a given trade token (i.e., bids).
   * Used to display "Buy Orders" on the deal details page.
   */
  async getActiveBuyOrdersForToken(
    tradeTokenCode: string,
    tradeTokenIssuer: string,
  ): Promise<
    Array<{
      offerId: string;
      buyer: string;
      amount: string;
      price: string;
    }>
  > {
    const tradeAsset = createAsset(tradeTokenCode, tradeTokenIssuer);

    const offersPage = await this.server
      .offers()
      .selling(this.usdcAsset)
      .buying(tradeAsset)
      .limit(50)
      .call();

    return offersPage.records.map((offer: any) => ({
      offerId: offer.id,
      buyer: offer.seller,
      amount: offer.amount,
      price: offer.price,
    }));
  }

  /**
   * Submits a transaction with exponential backoff retry for transient Horizon errors.
   * Retries on HTTP 429, 503, 504, and network timeout errors.
   * Waits 1s → 2s → 4s before each retry; throws after 3 failed attempts.
   */
  private async submitWithRetry(tx: any): Promise<any> {
    const RETRYABLE = new Set([429, 503, 504]);
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.server.submitTransaction(tx);
      } catch (err: any) {
        const status: number | undefined = err?.response?.status;
        const isTimeout =
          err?.code === 'ECONNABORTED' || err?.message?.includes('timeout');
        const isRetryable =
          (status !== undefined && RETRYABLE.has(status)) || isTimeout;

        if (!isRetryable || attempt === MAX_RETRIES) {
          throw err;
        }

        const delayMs = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
        this.logger.warn(
          { attempt, status, delayMs },
          `Transient Horizon error (${status ?? 'timeout'}); retrying in ${delayMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  /**
   * Submits a signed XDR transaction to the Stellar network.
   * Optionally validates the XDR envelope before submission.
   */
  async submitTransaction(
    signedXdr: string,
    validateOpts?: {
      allowedOpTypes?: string[];
      allowedDestinations?: string[];
    },
  ): Promise<any> {
    if (validateOpts) {
      const validation = await this.validateTransactionXdr(
        signedXdr,
        validateOpts.allowedOpTypes,
        validateOpts.allowedDestinations,
      );
      if (!validation.valid) {
        throw new Error(`XDR validation failed: ${validation.reason}`);
      }
    }

    const tx = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);
    try {
      const result = await this.submitWithRetry(tx);
      const txHash = (result as any).hash as string;
      this.logger.info({ txId: txHash }, 'Transaction submitted successfully');
      await this.saveLog({
        txHash,
        xdrBody: signedXdr,
        status: TxStatus.SUCCESS,
      });
      return result;
    } catch (err: any) {
      const errorCode: string =
        err?.response?.data?.extras?.result_codes?.transaction ?? err.message;
      await this.saveLog({
        xdrBody: signedXdr,
        status: TxStatus.FAILED,
        errorCode,
      });
      throw err;
    }
  }

  /**
   * Returns the status of a Stellar transaction.
   */
  async getTransactionStatus(
    txId: string,
  ): Promise<'success' | 'failed' | 'pending'> {
    try {
      const tx = await this.server.transactions().transaction(txId).call();
      return tx.successful ? 'success' : 'failed';
    } catch (err: any) {
      if (err?.response?.status === 404) {
        return 'pending';
      }
      throw err;
    }
  }

  /**
   * Freezes (or unfreezes) a specific investor's trustline for a trade asset.
   * Requires the issuer account to have AUTH_REVOCABLE set (flag 2), which is
   * applied during issueTradeToken via setFlags: 10 (AuthRevocable | AuthClawback).
   *
   * Uses setTrustLineFlags (allowTrust is deprecated in SDK v13).
   *
   * @param issuerSecret  Decrypted issuer secret key for the asset
   * @param assetCode     Asset code (e.g. "COCOA1002")
   * @param issuerPublicKey  Issuer public key
   * @param trustorWallet Investor wallet address whose trustline to freeze
   * @param freeze        true = freeze (revoke authorization), false = unfreeze
   * @returns Stellar transaction ID
   */
  async freezeAsset(
    issuerSecret: string,
    assetCode: string,
    issuerPublicKey: string,
    trustorWallet: string,
    freeze: boolean,
  ): Promise<string> {
    const issuerKeypair = Keypair.fromSecret(issuerSecret);
    const issuerAccount = await this.server.loadAccount(issuerPublicKey);
    const asset = createAsset(assetCode, issuerPublicKey);

    const tx = new TransactionBuilder(issuerAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.setTrustLineFlags({
          trustor: trustorWallet,
          asset,
          flags: { authorized: !freeze },
        }),
      )
      .setTimeout(30)
      .build();

    tx.sign(issuerKeypair);
    const result = await this.submitWithRetry(tx);
    const txId = (result as any).hash as string;

    this.logger.info(
      { assetCode, issuerPublicKey, trustorWallet, freeze, txId },
      `Asset trustline ${freeze ? 'frozen' : 'unfrozen'} for ${trustorWallet}`,
    );
    return txId;
  }

  /**
   * Cleans up an investor's trustline for a trade asset after final distribution.
   * Submits a changeTrust operation with limit=0, removing the trustline and
   * freeing up the 0.5 XLM base reserve on the investor's account.
   *
   * @param investorWallet  Investor's public key
   * @param investorSecret  Investor's decrypted secret key
   * @param assetCode       Trade token asset code (e.g. "COCOA1002")
   * @param issuerPublicKey Trade token issuer public key
   * @returns Stellar transaction ID of the cleanup transaction
   */
  async cleanupInvestorTrustline(
    investorWallet: string,
    investorSecret: string,
    assetCode: string,
    issuerPublicKey: string,
  ): Promise<string> {
    const investorKeypair = Keypair.fromSecret(investorSecret);
    const investorAccount = await this.server.loadAccount(investorWallet);
    const tradeAsset = createAsset(assetCode, issuerPublicKey);

    const balance = investorAccount.balances.find(
      (b: any) =>
        b.asset_type !== 'native' &&
        b.asset_code === assetCode &&
        b.asset_issuer === issuerPublicKey,
    );

    if (!balance) {
      this.logger.warn(
        { investorWallet, assetCode },
        'No trustline found to clean up',
      );
      return '';
    }

    if (parseFloat((balance as any).balance) > 0) {
      throw new Error(
        `Cannot remove trustline: investor still holds ${(balance as any).balance} ${assetCode}`,
      );
    }

    const tx = new TransactionBuilder(investorAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.changeTrust({
          asset: tradeAsset,
          limit: '0',
        }),
      )
      .addMemo(Memo.text(`cleanup:${assetCode}`))
      .setTimeout(30)
      .build();

    tx.sign(investorKeypair);
    const result = await this.submitWithRetry(tx);
    const txId = (result as any).hash as string;

    this.logger.info(
      { investorWallet, assetCode, issuerPublicKey, txId },
      'Investor trustline cleaned up successfully',
    );
    return txId;
  }

  /**
   * Clawbacks tokens from all current holders back to the issuer.
   */
  async clawbackTokens(
    assetCode: string,
    issuerPublicKey: string,
    issuerSecret: string,
    holders: { walletAddress: string; tokenAmount: number }[],
  ): Promise<void> {
    const issuerKeypair = Keypair.fromSecret(issuerSecret);
    const issuerAccount = await this.server.loadAccount(issuerPublicKey);

    if (!issuerAccount.flags.auth_clawback_enabled) {
      throw new Error('Token does not have clawback enabled');
    }

    const tradeAsset = createAsset(assetCode, issuerPublicKey);

    const txBuilder = new TransactionBuilder(issuerAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    });

    for (const holder of holders) {
      if (holder.tokenAmount > 0) {
        txBuilder.addOperation(
          Operation.clawback({
            asset: tradeAsset,
            from: holder.walletAddress,
            amount: holder.tokenAmount.toFixed(7),
          }),
        );
      }
    }

    const tx = txBuilder.setTimeout(300).build();
    tx.sign(issuerKeypair);

    try {
      await this.submitWithRetry(tx);
      this.logger.info(
        { assetCode, issuerPublicKey, holdersCount: holders.length },
        'Tokens clawed back successfully',
      );
    } catch (err: any) {
      this.logger.error(`Clawback failed: ${err.message}`, err.stack);
      throw new Error(`Clawback failed: ${err.message}`);
    }
  }
}
