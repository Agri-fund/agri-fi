import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Sep24Controller } from './sep24.controller';
import { Sep24Service } from './sep24.service';
import { Sep24TxKind, Sep24TxStatus } from './entities/sep24-transaction.entity';

const STELLAR_ACCOUNT = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGWKX2ZVBFGCNX5J3MHAQX';

const mockSep24Service = {
  getInfo: jest.fn(),
  initiateDepositInteractive: jest.fn(),
  initiateWithdrawInteractive: jest.fn(),
  getTransaction: jest.fn(),
  listTransactions: jest.fn(),
  handleStatusCallback: jest.fn(),
  assertAccountMatchesWallet: jest.fn(),
};

const mockRequest = (walletAddress: string | null) => ({
  user: { id: 'user-1', walletAddress },
});

describe('Sep24Controller', () => {
  let controller: Sep24Controller;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [Sep24Controller],
      providers: [{ provide: Sep24Service, useValue: mockSep24Service }],
    }).compile();

    controller = module.get(Sep24Controller);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('returns info without authentication', () => {
    mockSep24Service.getInfo.mockReturnValue({ deposit: {}, withdraw: {} });
    expect(controller.getInfo()).toEqual({ deposit: {}, withdraw: {} });
  });

  it('initiates deposit interactive flow', async () => {
    mockSep24Service.initiateDepositInteractive.mockResolvedValue({
      id: 'tx-1',
      url: 'http://localhost:3000/sep24/interactive?transaction_id=tx-1',
      type: 'interactive_customer_info_needed',
    });

    const result = await controller.depositInteractive(
      { asset_code: 'USDC', account: STELLAR_ACCOUNT, amount: '100' },
      mockRequest(STELLAR_ACCOUNT) as any,
    );

    expect(mockSep24Service.assertAccountMatchesWallet).toHaveBeenCalledWith(
      STELLAR_ACCOUNT,
      STELLAR_ACCOUNT,
    );
    expect(result.type).toBe('interactive_customer_info_needed');
  });

  it('initiates withdraw interactive flow', async () => {
    mockSep24Service.initiateWithdrawInteractive.mockResolvedValue({
      id: 'tx-2',
      url: 'http://localhost:3000/sep24/interactive?transaction_id=tx-2',
      type: 'interactive_customer_info_needed',
    });

    await controller.withdrawInteractive(
      {
        asset_code: 'USDC',
        account: STELLAR_ACCOUNT,
        dest: '0123456789',
      },
      mockRequest(STELLAR_ACCOUNT) as any,
    );

    expect(mockSep24Service.initiateWithdrawInteractive).toHaveBeenCalled();
  });

  it('returns transaction by id', async () => {
    mockSep24Service.getTransaction.mockResolvedValue({
      transaction: { id: 'tx-1', status: Sep24TxStatus.PENDING_ANCHOR },
    });

    const result = await controller.getTransaction(
      'tx-1',
      mockRequest(STELLAR_ACCOUNT) as any,
    );

    expect(mockSep24Service.getTransaction).toHaveBeenCalledWith(
      'tx-1',
      STELLAR_ACCOUNT,
    );
    expect(result.transaction.id).toBe('tx-1');
  });

  it('lists deposit transactions', async () => {
    mockSep24Service.listTransactions.mockResolvedValue({ transactions: [] });

    await controller.listDeposits(mockRequest(STELLAR_ACCOUNT) as any);

    expect(mockSep24Service.listTransactions).toHaveBeenCalledWith(
      Sep24TxKind.DEPOSIT,
      STELLAR_ACCOUNT,
    );
  });

  it('processes status callback webhook', async () => {
    mockSep24Service.handleStatusCallback.mockResolvedValue(undefined);

    const result = await controller.handleCallback({
      transaction_id: 'tx-1',
      status: Sep24TxStatus.COMPLETED,
    });

    expect(result).toEqual({ received: true });
    expect(mockSep24Service.handleStatusCallback).toHaveBeenCalled();
  });

  it('rejects deposit when wallet is not linked', async () => {
    mockSep24Service.assertAccountMatchesWallet.mockImplementation(() => {
      throw new ForbiddenException('No wallet address linked to your account.');
    });

    await expect(
      controller.depositInteractive(
        { asset_code: 'USDC', account: STELLAR_ACCOUNT },
        mockRequest(null) as any,
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
