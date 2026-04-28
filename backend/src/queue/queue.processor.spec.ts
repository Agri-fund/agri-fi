import { QueueProcessor } from './queue.processor';

describe('QueueProcessor', () => {
  let processor: QueueProcessor;
  let stellarService: {
    decryptSecret: jest.Mock;
    issueTradeToken: jest.Mock;
    encryptSecret: jest.Mock;
    submitTransaction: jest.Mock;
    transferTradeTokens: jest.Mock;
  };
  let tradeDealRepo: { update: jest.Mock };
  let investmentRepo: { update: jest.Mock };
  let userRepo: { findOne: jest.Mock };
  let notificationsService: { sendEmail: jest.Mock };
  let logger: {
    setContext: jest.Mock;
    assign: jest.Mock;
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
  let context: {
    getChannelRef: jest.Mock;
    getMessage: jest.Mock;
  };
  let channel: { ack: jest.Mock };
  const message = { fields: { deliveryTag: 1 } };

  beforeEach(() => {
    stellarService = {
      decryptSecret: jest.fn(),
      issueTradeToken: jest.fn(),
      encryptSecret: jest.fn(),
      submitTransaction: jest.fn(),
      transferTradeTokens: jest.fn(),
    };
    tradeDealRepo = { update: jest.fn() };
    investmentRepo = { update: jest.fn() };
    userRepo = { findOne: jest.fn() };
    notificationsService = { sendEmail: jest.fn() };
    logger = {
      setContext: jest.fn(),
      assign: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    channel = { ack: jest.fn() };
    context = {
      getChannelRef: jest.fn().mockReturnValue(channel),
      getMessage: jest.fn().mockReturnValue(message),
    };

    processor = new QueueProcessor(
      stellarService as any,
      {} as any,
      tradeDealRepo as any,
      investmentRepo as any,
      userRepo as any,
      notificationsService as any,
      logger as any,
    );
  });

  describe('handleDealPublish', () => {
    it('encrypts issuer secret before persisting the published deal', async () => {
      stellarService.decryptSecret.mockReturnValue('plain-escrow-secret');
      stellarService.issueTradeToken.mockResolvedValue({
        txId: 'tx-123',
        issuerPublicKey: 'GISSUER123',
        issuerSecret: 'plain-issuer-secret',
      });
      stellarService.encryptSecret.mockReturnValue('encrypted-issuer-secret');
      tradeDealRepo.update.mockResolvedValue({ affected: 1 });

      await processor.handleDealPublish(
        {
          dealId: 'deal-uuid',
          tokenSymbol: 'COCOAdeal',
          escrowPublicKey: 'GESCROW123',
          encryptedEscrowSecret: 'encrypted-escrow-secret',
          tokenCount: 50,
        },
        context as any,
      );

      expect(stellarService.decryptSecret).toHaveBeenCalledWith(
        'encrypted-escrow-secret',
      );
      expect(stellarService.issueTradeToken).toHaveBeenCalledWith(
        'COCOAdeal',
        'GESCROW123',
        'plain-escrow-secret',
        50,
      );
      expect(stellarService.encryptSecret).toHaveBeenCalledWith(
        'plain-issuer-secret',
      );
      expect(tradeDealRepo.update).toHaveBeenCalledWith('deal-uuid', {
        status: 'open',
        stellarAssetTxId: 'tx-123',
        issuerPublicKey: 'GISSUER123',
        issuerSecretKey: 'encrypted-issuer-secret',
      });
      expect(tradeDealRepo.update).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ issuerSecretKey: 'plain-issuer-secret' }),
      );
      expect(channel.ack).toHaveBeenCalledWith(message);
    });

    it('does not persist the issuer secret if encryption returns plaintext', async () => {
      stellarService.decryptSecret.mockReturnValue('plain-escrow-secret');
      stellarService.issueTradeToken.mockResolvedValue({
        txId: 'tx-123',
        issuerPublicKey: 'GISSUER123',
        issuerSecret: 'plain-issuer-secret',
      });
      stellarService.encryptSecret.mockReturnValue('plain-issuer-secret');
      tradeDealRepo.update.mockResolvedValue({ affected: 1 });

      await processor.handleDealPublish(
        {
          dealId: 'deal-uuid',
          tokenSymbol: 'COCOAdeal',
          escrowPublicKey: 'GESCROW123',
          encryptedEscrowSecret: 'encrypted-escrow-secret',
          tokenCount: 50,
        },
        context as any,
      );

      expect(stellarService.encryptSecret).toHaveBeenCalledWith(
        'plain-issuer-secret',
      );
      expect(tradeDealRepo.update).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ issuerSecretKey: 'plain-issuer-secret' }),
      );
      expect(tradeDealRepo.update).toHaveBeenCalledWith('deal-uuid', {
        status: 'failed',
      });
      expect(channel.ack).toHaveBeenCalledWith(message);
    });
  });
});
