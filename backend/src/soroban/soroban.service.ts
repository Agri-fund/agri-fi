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
  rpc,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  Address,
  xdr,
  scValToNative,
  Operation,
  SorobanDataBuilder,
} from '@stellar/stellar-sdk';

export interface CampaignConfig {
  admin: string;
  farmer: string;
  usdcToken: string;
  fundingTarget: bigint; // in USDC stroops (1 USDC = 10_000_000)
  deadline: number; // unix timestamp
  platformFeeBps: number; // 200 = 2%
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
  private readonly rpcServer: rpc.Server;
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

    this.rpcServer = new rpc.Server(rpcUrl, { allowHttp: false });

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
    if (rpc.Api.isSimulationError(simResult)) {
      throw new Error(`Soroban simulation failed: ${simResult.error}`);
    }

    const successSim = simResult as rpc.Api.SimulateTransactionSuccessResponse;
    this.logger.debug(
      {
        contractId,
        method,
        minResourceFee: successSim.minResourceFee,
      },
      'Soroban simulation succeeded',
    );

    const preparedTx = rpc.assembleTransaction(tx, successSim).build();
    preparedTx.sign(signer);

    const sendResult = await this.rpcServer.sendTransaction(preparedTx);
    if (sendResult.status === 'ERROR') {
      throw new Error(
        `Soroban tx submission failed: ${sendResult.errorResult}`,
      );
    }

    // Poll for confirmation
    const hash = sendResult.hash;
    let getResult = await this.rpcServer.getTransaction(hash);
    let attempts = 0;

    while (
      getResult.status === rpc.Api.GetTransactionStatus.NOT_FOUND &&
      attempts < 20
    ) {
      await new Promise((r) => setTimeout(r, 1500));
      getResult = await this.rpcServer.getTransaction(hash);
      attempts++;
    }

    if (getResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new Error(`Soroban tx failed or timed out: ${getResult.status}`);
    }

    this.logger.info(
      { contractId, method, hash },
      'Soroban contract call succeeded',
    );
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
    const account = await this.rpcServer.getAccount(
      this.platformKeypair.publicKey(),
    );
    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const simResult = await this.rpcServer.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simResult)) {
      throw new Error(`Soroban read failed: ${simResult.error}`);
    }

    const successResult =
      simResult as rpc.Api.SimulateTransactionSuccessResponse;
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

  async releaseMilestone(
    contractId: string,
    milestoneIndex: number,
  ): Promise<string> {
    const args = [
      new Address(this.platformKeypair.publicKey()).toScVal(),
      nativeToScVal(milestoneIndex, { type: 'u32' }),
    ];
    return this.invokeContract(contractId, 'release_milestone', args);
  }

  async distributeRevenue(
    contractId: string,
    revenueAmount: bigint,
  ): Promise<string> {
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

  async getInvestorOwnership(
    contractId: string,
    investorAddress: string,
  ): Promise<number> {
    const args = [new Address(investorAddress).toScVal()];
    const result = await this.readContract(
      contractId,
      'get_ownership_pct',
      args,
    );
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

  async getCampaignFromFactory(
    factoryContractId: string,
    dealId: string,
  ): Promise<unknown> {
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

  async getMarketplaceOrder(
    settlementContractId: string,
    orderId: string,
  ): Promise<unknown> {
    const args = [nativeToScVal(orderId, { type: 'string' })];
    return this.readContract(settlementContractId, 'get_order', args);
  }

  // ── Rent / State Expiration Management (#698) ────────────────────────────────

  /**
   * Extends the TTL (Time-To-Live) of a contract's persistent storage so that
   * the contract state does not expire and become archived on the Soroban ledger.
   *
   * Soroban charges "rent" for persistent storage. If a contract's storage entries
   * are not refreshed before their ledger sequence expiry, they become ARCHIVED and
   * the contract becomes unusable — escrow payouts would fail.
   *
   * @param contractId  - Soroban contract address (C…)
   * @param extendTo    - Target TTL in ledgers from the current ledger sequence.
   *                      Default: 535_680 (~30 days at 5 s/ledger on testnet).
   */
  async extendContractTtl(
    contractId: string,
    extendTo = 535_680,
  ): Promise<string> {
    const signer = this.platformKeypair;
    const account = await this.rpcServer.getAccount(signer.publicKey());

    const contract = new Contract(contractId);
    // getFootprint() returns the LedgerKey set covering the contract instance
    // and its backing WASM code — the full footprint needed for TTL extension.
    const footprint = contract.getFootprint();

    const sorobanData = new SorobanDataBuilder()
      .setReadOnly(footprint)
      .build();

    let tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .setSorobanData(sorobanData)
      .addOperation(
        Operation.extendFootprintTtl({ extendTo }),
      )
      .setTimeout(30)
      .build();

    // prepareTransaction simulates + assembles the transaction with correct fees
    tx = await this.rpcServer.prepareTransaction(tx);
    tx.sign(signer);

    const sendResult = await this.rpcServer.sendTransaction(tx);
    if (sendResult.status === 'ERROR') {
      throw new Error(
        `extend_footprint_ttl submission failed for ${contractId}: ${sendResult.errorResult}`,
      );
    }

    const hash = sendResult.hash;
    await this.waitForTransaction(hash);

    this.logger.info(
      { contractId, extendTo, hash },
      'Contract TTL extended successfully',
    );
    return hash;
  }

  /**
   * Restores an ARCHIVED contract instance so it can be used again.
   *
   * When a contract's persistent storage expires it enters the ARCHIVED state.
   * A restore_footprint operation pays the required rent and unarchives the
   * storage entries, bringing the contract back to a usable state.
   *
   * After restoration, call extendContractTtl() to set a long TTL so the
   * contract doesn't immediately expire again.
   *
   * @param contractId - Soroban contract address (C…) to restore
   */
  async restoreArchivedContract(contractId: string): Promise<string> {
    const signer = this.platformKeypair;
    const account = await this.rpcServer.getAccount(signer.publicKey());

    const contract = new Contract(contractId);
    const footprint = contract.getFootprint();

    const sorobanData = new SorobanDataBuilder()
      .setReadWrite(footprint)
      .build();

    let tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .setSorobanData(sorobanData)
      .addOperation(Operation.restoreFootprint({}))
      .setTimeout(30)
      .build();

    tx = await this.rpcServer.prepareTransaction(tx);
    tx.sign(signer);

    const sendResult = await this.rpcServer.sendTransaction(tx);
    if (sendResult.status === 'ERROR') {
      throw new Error(
        `restore_footprint submission failed for ${contractId}: ${sendResult.errorResult}`,
      );
    }

    const hash = sendResult.hash;
    await this.waitForTransaction(hash);

    this.logger.info(
      { contractId, hash },
      'Archived contract restored successfully',
    );
    return hash;
  }

  /**
   * Returns the current TTL (ledgers until expiry) for a contract's instance
   * storage entry, or null if the entry is not found / already archived.
   */
  async getContractTtl(contractId: string): Promise<number | null> {
    try {
      const contract = new Contract(contractId);
      const instanceKey = xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract: contract.address().toScAddress(),
          key: xdr.ScVal.scvLedgerKeyContractInstance(),
          durability: xdr.ContractDataDurability.persistent(),
        }),
      );

      const response = await this.rpcServer.getLedgerEntries(instanceKey);
      if (!response.entries || response.entries.length === 0) return null;

      const entry = response.entries[0];
      const currentLedger = response.latestLedger;
      const expiresAt = (entry as any).liveUntilLedgerSeq as number | undefined;
      if (expiresAt == null) return null;

      return Math.max(0, expiresAt - currentLedger);
    } catch (err: any) {
      this.logger.warn(
        { contractId, err: err.message },
        'Failed to fetch contract TTL',
      );
      return null;
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async waitForTransaction(hash: string): Promise<void> {
    let getResult = await this.rpcServer.getTransaction(hash);
    let attempts = 0;

    while (
      getResult.status === rpc.Api.GetTransactionStatus.NOT_FOUND &&
      attempts < 20
    ) {
      await new Promise((r) => setTimeout(r, 1500));
      getResult = await this.rpcServer.getTransaction(hash);
      attempts++;
    }

    if (getResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new Error(`Transaction timed out or failed: ${getResult.status} (hash: ${hash})`);
    }
  }
}
