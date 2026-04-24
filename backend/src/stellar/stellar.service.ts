import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import {
  Horizon,
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
  Asset,
  BASE_FEE,
  Memo,
} from 'stellar-sdk';
import {
  createDecipheriv,
  createCipheriv,
  randomBytes,
  createHash,
} from 'crypto';

export interface InvestorShare {
  walletAddress: string;
  tokenAmount: number;
  totalTokens: number;
}

@Injectable()
export class StellarService {
  private readonly server: Horizon.Server;
  private readonly networkPassphrase: string;
  private readonly platformKeypair: Keypair;
  private readonly usdcAsset: Asset;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(StellarService.name);

    const horizonUrl = config.get<string>(
      'STELLAR_HORIZON_URL',
      'https://horizon-testnet.stellar.org',
    );
    const network = config.get<string>('STELLAR_NETWORK', 'testnet');

    this.server = new Horizon.Server(horizonUrl);
    this.networkPassphrase =
      network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

    const platformSecret = config.get<string>('STELLAR_PLATFORM_SECRET', '');
    this.platformKeypair = platformSecret
      ? Keypair.fromSecret(platformSecret)
      : Keypair.random();

    const usdcAssetCode = config.get<string>('USDC_ASSET_CODE', 'USDC');
    const usdcIssuer = config.get<string>('USDC_ISSUER', '');
    this.usdcAsset = usdcIssuer
      ? new Asset(usdcAssetCode, usdcIssuer)
      : Asset.native(); // fallback to XLM only if issuer not configured

    this.logger.info(
      { network, horizonUrl, usdcAssetCode, usdcIssuer: usdcIssuer || 'NOT_SET' },
      `StellarService initialized on ${network}`,
    );
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
    await this.server.submitTransaction(tx);

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
      await this.server.submitTransaction(trustlineTx);
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
      .setTimeout(30)
      .build();

    fundIssuerTx.sign(this.platformKeypair);
    await this.server.submitTransaction(fundIssuerTx);

    const tradeAsset = new Asset(assetCode, issuerKeypair.publicKey());

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
    await this.server.submitTransaction(trustlineTx);

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
    const mintResult = await this.server.submitTransaction(mintTx);

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
    const result = await this.server.submitTransaction(tx);
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

    const tradeToken = new Asset(assetCode, escrowPublicKey);

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

    const result = await this.server.submitTransaction(tx);
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
  encryptSecret(secret: string): string {
    const key = Buffer.from(
      this.config
        .get<string>('ENCRYPTION_KEY', '')
        .padEnd(32, '0')
        .slice(0, 32),
    );
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }

  /**
   * Decrypts a secret key encrypted by encryptSecret().
   */
  decryptSecret(encryptedSecret: string): string {
    const key = Buffer.from(
      this.config
        .get<string>('ENCRYPTION_KEY', '')
        .padEnd(32, '0')
        .slice(0, 32),
    );
    const [ivHex, encryptedHex] = encryptedSecret.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  }

  /**
   * Releases escrow funds: farmer (98%), investors (proportional), platform (2%).
   * Returns an array of transaction IDs for each payment.
   */
  async releaseEscrow(
    escrowSecret: string,
    farmerWallet: string,
    investorShares: InvestorShare[],
    platformWallet: string,
    totalValue: number,
  ): Promise<string[]> {
    const escrowKeypair = Keypair.fromSecret(escrowSecret);
    const escrowAccount = await this.server.loadAccount(
      escrowKeypair.publicKey(),
    );

    // Convert to stroops (1 XLM = 10^7 stroops)
    const totalStroops = Math.round(totalValue * 1e7);

    if (totalStroops <= 0) {
      throw new Error('Invalid totalValue');
    }

    // Calculate platform + farmer
    const platformStroops = Math.floor(totalStroops * 0.02);
    const farmerStroops = Math.floor(totalStroops * 0.98);

    // Compute total tokens safely
    const totalTokens = investorShares.reduce(
      (sum, s) => sum + s.tokenAmount,
      0,
    );

    if (totalTokens <= 0) {
      throw new Error('Invalid investor token distribution');
    }

    const txBuilder = new TransactionBuilder(escrowAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    });

    // Farmer payment (USDC)
    txBuilder.addOperation(
      Operation.payment({
        destination: farmerWallet,
        asset: this.usdcAsset,
        amount: (farmerStroops / 1e7).toFixed(7),
      }),
    );

    // Investors
    let distributedToInvestors = 0;

    investorShares.forEach((share, index) => {
      let shareStroops = Math.floor(
        (share.tokenAmount / totalTokens) * totalStroops,
      );

      // Fix rounding remainder on last investor
      if (index === investorShares.length - 1) {
        shareStroops =
          totalStroops -
          farmerStroops -
          platformStroops -
          distributedToInvestors;
      }

      distributedToInvestors += shareStroops;

      txBuilder.addOperation(
        Operation.payment({
          destination: share.walletAddress,
          asset: this.usdcAsset,
          amount: (shareStroops / 1e7).toFixed(7),
        }),
      );
    });

    // Platform fee (USDC)
    txBuilder.addOperation(
      Operation.payment({
        destination: platformWallet,
        asset: this.usdcAsset,
        amount: (platformStroops / 1e7).toFixed(7),
      }),
    );

    const tx = txBuilder.setTimeout(30).build();
    tx.sign(escrowKeypair);

    try {
      const result = await this.server.submitTransaction(tx);
      const txId = (result as any).hash as string;

      this.logger.info({ txId }, 'Escrow released successfully');
      return [txId];
    } catch (err: any) {
      this.logger.error(`Escrow release failed: ${err.message}`, err.stack);
      throw new Error(`Escrow release failed: ${err.message}`);
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
    const result = await this.server.submitTransaction(tx);
    return (result as any).hash as string;
  }

  /**
   * Creates an unsigned XDR transaction for an investment using USDC.
   * The investor will sign this transaction to fund the escrow account.
   */
  async createInvestmentTransaction(
    investorWallet: string,
    escrowPublicKey: string,
    amountUSD: number,
    assetCode: string,
    tokenAmount: number,
  ): Promise<string> {
    const investorAccount = await this.server.loadAccount(investorWallet);

    // Use USDC for stable USD-denominated payments
    const tx = new TransactionBuilder(investorAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: escrowPublicKey,
          asset: this.usdcAsset,
          amount: amountUSD.toFixed(7),
        }),
      )
      .addMemo(Memo.text(`invest:${assetCode}:${tokenAmount}`))
      .setTimeout(300) // 5 minutes for user to sign
      .build();

    return tx.toXDR();
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

    // Each operation costs BASE_FEE stroops; multiply by number of operations
    const feePerOp = parseInt(BASE_FEE, 10);
    const totalFee = (feePerOp * investments.length).toString();

    const txBuilder = new TransactionBuilder(investorAccount, {
      fee: totalFee,
      networkPassphrase: this.networkPassphrase,
    });

    for (const inv of investments) {
      txBuilder.addOperation(
        Operation.payment({
          destination: inv.escrowPublicKey,
          asset: this.usdcAsset,
          amount: inv.amountUSD.toFixed(7),
        }),
      );
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
        totalFee,
      },
      'Bulk investment transaction built',
    );

    return tx.toXDR();
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
    const tradeAsset = new Asset(tradeTokenCode, tradeTokenIssuer);

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
    const tradeAsset = new Asset(tradeTokenCode, tradeTokenIssuer);

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
   * Submits a signed XDR transaction to the Stellar network.
   */
  async submitTransaction(signedXdr: string): Promise<any> {
    const tx = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);
    const result = await this.server.submitTransaction(tx);

    this.logger.info(
      { txId: (result as any).hash },
      'Transaction submitted successfully',
    );
    return result;
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
}
