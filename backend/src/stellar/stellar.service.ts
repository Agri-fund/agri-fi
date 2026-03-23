import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

export interface InvestorShare {
  walletAddress: string;
  tokenAmount: number;
  totalTokens: number;
}

@Injectable()
export class StellarService {
  private readonly logger = new Logger(StellarService.name);
  private readonly server: Horizon.Server;
  private readonly networkPassphrase: string;
  private readonly platformKeypair: Keypair;

  constructor(private readonly config: ConfigService) {
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

    this.logger.log(`StellarService initialized on ${network}`);
  }

  /**
   * Creates a new Stellar escrow account funded with minimum XLM balance.
   * Returns the keypair for the escrow account.
   */
  async createEscrowAccount(
    tradeDealId: string,
  ): Promise<{ publicKey: string; secretKey: string }> {
    const escrowKeypair = Keypair.random();

    const platformAccount = await this.server.loadAccount(
      this.platformKeypair.publicKey(),
    );

    const tx = new TransactionBuilder(platformAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.createAccount({
          destination: escrowKeypair.publicKey(),
          startingBalance: '2', // minimum XLM for account + trustline
        }),
      )
      .addMemo(Memo.text(`escrow:${tradeDealId.slice(0, 20)}`))
      .setTimeout(30)
      .build();

    tx.sign(this.platformKeypair);

    await this.server.submitTransaction(tx);

    this.logger.log(
      `Escrow account created: ${escrowKeypair.publicKey()} for deal ${tradeDealId}`,
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
    this.logger.log(
      `Trade token ${assetCode} issued. txId=${txId}, issuer=${issuerKeypair.publicKey()}`,
    );

    return {
      txId,
      issuerPublicKey: issuerKeypair.publicKey(),
      issuerSecret: issuerKeypair.secret(),
    };
  }

  /**
   * Funds the escrow account from an investor wallet.
   * Returns the Stellar transaction ID.
   */
  async fundEscrow(
    escrowPublicKey: string,
    investorWallet: string,
    amountUSD: string,
  ): Promise<string> {
    // In MVP, we use XLM as the payment asset (1 XLM ≈ $1 for testnet simplicity)
    // Production would use USDC
    const investorAccount = await this.server.loadAccount(investorWallet);

    const tx = new TransactionBuilder(investorAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: escrowPublicKey,
          asset: Asset.native(),
          amount: amountUSD,
        }),
      )
      .setTimeout(30)
      .build();

    // Note: in production the investor signs this via their wallet (Freighter/Albedo)
    // For backend-initiated flows, we'd need the investor's secret — omitted here
    const result = await this.server.submitTransaction(tx);
    return (result as any).hash as string;
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

    const platformFee = totalValue * 0.02;
    const farmerAmount = totalValue * 0.98;

    const txBuilder = new TransactionBuilder(escrowAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    });

    // Farmer payment
    txBuilder.addOperation(
      Operation.payment({
        destination: farmerWallet,
        asset: Asset.native(),
        amount: farmerAmount.toFixed(7),
      }),
    );

    // Investor distributions (proportional)
    for (const share of investorShares) {
      const investorAmount =
        (share.tokenAmount / share.totalTokens) * totalValue;
      txBuilder.addOperation(
        Operation.payment({
          destination: share.walletAddress,
          asset: Asset.native(),
          amount: investorAmount.toFixed(7),
        }),
      );
    }

    // Platform fee
    txBuilder.addOperation(
      Operation.payment({
        destination: platformWallet,
        asset: Asset.native(),
        amount: platformFee.toFixed(7),
      }),
    );

    const tx = txBuilder.setTimeout(30).build();
    tx.sign(escrowKeypair);

    const result = await this.server.submitTransaction(tx);
    const txId = (result as any).hash as string;

    this.logger.log(`Escrow released for deal. txId=${txId}`);
    return [txId];
  }

  /**
   * Records an arbitrary memo on Stellar (used for milestone anchoring and document hashes).
   * Returns the transaction ID.
   */
  async recordMemo(memo: string, signerSecret: string): Promise<string> {
    const signerKeypair = Keypair.fromSecret(signerSecret);
    const account = await this.server.loadAccount(signerKeypair.publicKey());

    // Stellar memo text is limited to 28 bytes; truncate if needed
    const memoText = memo.slice(0, 28);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: signerKeypair.publicKey(), // self-payment as anchor
          asset: Asset.native(),
          amount: '0.0000001',
        }),
      )
      .addMemo(Memo.text(memoText))
      .setTimeout(30)
      .build();

    tx.sign(signerKeypair);
    const result = await this.server.submitTransaction(tx);
    return (result as any).hash as string;
  }

  /**
   * Creates an unsigned XDR transaction for an investment.
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

    // In MVP, we use XLM as the payment asset (1 XLM ≈ $1 for testnet simplicity)
    // Production would use USDC
    const tx = new TransactionBuilder(investorAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: escrowPublicKey,
          asset: Asset.native(),
          amount: amountUSD.toString(),
        }),
      )
      .addMemo(Memo.text(`invest:${assetCode}:${tokenAmount}`))
      .setTimeout(300) // 5 minutes for user to sign
      .build();

    return tx.toXDR();
  }

  /**
   * Submits a signed XDR transaction to the Stellar network.
   */
  async submitTransaction(signedXdr: string): Promise<any> {
    const tx = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);
    const result = await this.server.submitTransaction(tx);
    
    this.logger.log(`Transaction submitted: ${(result as any).hash}`);
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
