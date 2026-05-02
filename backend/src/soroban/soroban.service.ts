/**
 * SorobanService
 *
 * Bridge between the NestJS backend and Soroban smart contracts on Stellar.
 * Handles contract invocation, XDR building, and transaction submission
 * for FarmCampaign, ProjectFactory, RevenueDistributor, and MarketplaceSettlement.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import {
  Contract,
  Keypair,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  Address,
  xdr,
  scValToNative,
} from 'stellar-sdk';

export interface CampaignConfig {
  admin: string;
  farmer: string;
  usdcToken: string;
  fundingTarget: bigint;   // in USDC stroops (1 USDC = 10_000_000)
  deadline: number;        // unix timestamp
  platformFeeBps: number;  // 200 = 2%
  milestoneCount: number;
  projectName: string;
  commodity: string;
}

export interface InvestorShareEntry {
  investor: string;
  shareBps: number;
}

@Injectable()
export class SorobanService {
  private readonly rpcServer: SorobanRpc.Server;
  private readonly networkPassphrase: string;
  private readonly platformKeypair: Keypair;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SorobanService.name);

    const rpcUrl = config.get<string>(
      'SOROBAN_RPC_URL',
      'https://soroban-testnet.stellar.org',
    );
    const network = config.get<string>('STELLAR_NETWORK', 'testnet');
    this.networkPassphrase =
      network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

    this.rpcServer = new SorobanRpc.Server(rpcUrl, { allowHttp: false });

    const platformSecret = config.get<string>('STELLAR_PLATFORM_SECRET', '');
    this.platformKeypair = platformSecret
      ? Keypair.fromSecret(platformSecret)
      : Keypair.random();

    this.logger.info({ rpcUrl, network }, 'SorobanService initialized');
  }

  // ── Contract invocation helpers ─────────────────────────────────────────────

  /**
   * Builds, simulates, and submits a Soroban contract call.
   * Returns the transaction hash on success.
   */
  async invokeContract(
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    signerKeypair?: Keypair,
  ): Promise<string> {
    const signer = signerKeypair ?? this.platformKeypair;
    const account = await this.rpcServer.getAccount(signer.publicKey());

    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    // Simulate to get footprint + resource fees
    const simResult = await this.rpcServer.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      throw new Error(`Soroban simulation failed: ${simResult.error}`);
    }

    const preparedTx = SorobanRpc.assembleTransaction(tx, simResult as SorobanRpc.Api.SimulateTransactionSuccessResponse).build();
    preparedTx.sign(signer);

    const sendResult = await this.rpcServer.sendTransaction(preparedTx);
    if (sendResult.status === 'ERROR') {
      throw new Error(`Soroban tx submission failed: ${sendResult.errorResult}`);
    }

    // Poll for confirmation
    const hash = sendResult.hash;
    let getResult = await this.rpcServer.getTransaction(hash);
    let attempts = 0;

    while (
      getResult.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND &&
      attempts < 20
    ) {
      await new Promise((r) => setTimeout(r, 1500));
      getResult = await this.rpcServer.getTransaction(hash);
      attempts++;
    }

    if (getResult.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      throw new Error(`Soroban tx failed or timed out: ${getResult.status}`);
    }

    this.logger.info({ contractId, method, hash }, 'Soroban contract call succeeded');
    return hash;
  }

  /**
   * Reads a contract value without submitting a transaction (view call).
   */
  async readContract(
    contractId: string,
    method: string,
    args: xdr.ScVal[],
  ): Promise<unknown> {
    const account = await this.rpcServer.getAccount(this.platformKeypair.publicKey());
    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const simResult = await this.rpcServer.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      throw new Error(`Soroban read failed: ${simResult.error}`);
    }

    const successResult = simResult as SorobanRpc.Api.SimulateTransactionSuccessResponse;
    if (!successResult.result) return null;
    return scValToNative(successResult.result.retval);
  }

  // ── FarmCampaign contract methods ───────────────────────────────────────────

  /**
   * Initializes a newly deployed FarmCampaign contract.
   * Called once after the contract is deployed via Soroban CLI / deploy script.
   */
  async initializeCampaign(
    contractId: string,
    cfg: CampaignConfig,
  ): Promise<string> {
    const args = [
      new Address(cfg.admin).toScVal(),
      new Address(cfg.farmer).toScVal(),
      new Address(cfg.usdcToken).toScVal(),
      nativeToScVal(cfg.fundingTarget, { type: 'i128' }),
      nativeToScVal(cfg.deadline, { type: 'u64' }),
      nativeToScVal(cfg.platformFeeBps, { type: 'u32' }),
      nativeToScVal(cfg.milestoneCount, { type: 'u32' }),
      nativeToScVal(cfg.projectName, { type: 'string' }),
      nativeToScVal(cfg.commodity, { type: 'string' }),
    ];
    return this.invokeContract(contractId, 'initialize', args);
  }

  async approveCampaign(contractId: string): Promise<string> {
    const args = [new Address(this.platformKeypair.publicKey()).toScVal()];
    return this.invokeContract(contractId, 'approve', args);
  }

  async releaseMilestone(contractId: string, milestoneIndex: number): Promise<string> {
    const args = [
      new Address(this.platformKeypair.publicKey()).toScVal(),
      nativeToScVal(milestoneIndex, { type: 'u32' }),
    ];
    return this.invokeContract(contractId, 'release_milestone', args);
  }

  async distributeRevenue(contractId: string, revenueAmount: bigint): Promise<string> {
    const args = [
      new Address(this.platformKeypair.publicKey()).toScVal(),
      nativeToScVal(revenueAmount, { type: 'i128' }),
    ];
    return this.invokeContract(contractId, 'distribute_revenue', args);
  }

  async pauseCampaign(contractId: string): Promise<string> {
    const args = [new Address(this.platformKeypair.publicKey()).toScVal()];
    return this.invokeContract(contractId, 'pause', args);
  }

  async markCampaignFailed(contractId: string): Promise<string> {
    const args = [new Address(this.platformKeypair.publicKey()).toScVal()];
    return this.invokeContract(contractId, 'mark_failed', args);
  }

  async getCampaignState(contractId: string): Promise<unknown> {
    return this.readContract(contractId, 'get_state', []);
  }

  async getInvestorOwnership(contractId: string, investorAddress: string): Promise<number> {
    const args = [new Address(investorAddress).toScVal()];
    const result = await this.readContract(contractId, 'get_ownership_pct', args);
    return Number(result ?? 0);
  }

  // ── ProjectFactory contract methods ─────────────────────────────────────────

  async registerCampaignOnChain(
    factoryContractId: string,
    dealId: string,
    campaignContractId: string,
    farmerAddress: string,
    commodity: string,
  ): Promise<string> {
    const args = [
      new Address(this.platformKeypair.publicKey()).toScVal(),
      nativeToScVal(dealId, { type: 'string' }),
      new Address(campaignContractId).toScVal(),
      new Address(farmerAddress).toScVal(),
      nativeToScVal(commodity, { type: 'string' }),
    ];
    return this.invokeContract(factoryContractId, 'register_campaign', args);
  }

  async getCampaignFromFactory(factoryContractId: string, dealId: string): Promise<unknown> {
    const args = [nativeToScVal(dealId, { type: 'string' })];
    return this.readContract(factoryContractId, 'get_campaign', args);
  }

  // ── MarketplaceSettlement contract methods ──────────────────────────────────

  async confirmMarketplaceDelivery(
    settlementContractId: string,
    orderId: string,
  ): Promise<string> {
    const args = [
      new Address(this.platformKeypair.publicKey()).toScVal(),
      nativeToScVal(orderId, { type: 'string' }),
    ];
    return this.invokeContract(settlementContractId, 'confirm_delivery', args);
  }

  async refundMarketplaceBuyer(
    settlementContractId: string,
    orderId: string,
  ): Promise<string> {
    const args = [
      new Address(this.platformKeypair.publicKey()).toScVal(),
      nativeToScVal(orderId, { type: 'string' }),
    ];
    return this.invokeContract(settlementContractId, 'refund_buyer', args);
  }

  async getMarketplaceOrder(settlementContractId: string, orderId: string): Promise<unknown> {
    const args = [nativeToScVal(orderId, { type: 'string' })];
    return this.readContract(settlementContractId, 'get_order', args);
  }
}
