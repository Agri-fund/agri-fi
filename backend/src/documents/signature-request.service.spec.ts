import {
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import * as openpgp from 'openpgp';
import {
  SignatureRequestService,
} from './signature-request.service';
import {
  SignatureRequest,
  SignatureRequestStatus,
} from './entities/signature-request.entity';

/**
 * Tests for the co-signer signing queue (issue #1005):
 *  - Watermark application (delegated to WatermarkService)
 *  - OpenPGP signature verification (trusted vs untrusted keys)
 *  - JWT signing-link expiry
 *  - Status tracking transitions
 */

describe('SignatureRequestService', () => {
  let service: SignatureRequestService;
  let jwtService: JwtService;
  let configService: ConfigService;

  const testTrustedKeys: { privateKey: any; publicKey: string } = {
    privateKey: null as any,
    publicKey: '',
  };

  const mockRequestRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    find: jest.fn(),
    update: jest.fn(),
  };

  const mockDocumentRepo = {
    findOne: jest.fn(),
  };

  const mockUserRepo = {
    findOne: jest.fn(),
  };

  const mockStellarService = {
    anchorIpfsCid: jest.fn(),
    networkPassphrase: 'testnet',
  };

  const mockNotificationsService = {
    createNotification: jest.fn().mockResolvedValue({}),
    sendEmail: jest.fn().mockResolvedValue(undefined),
  };

  const mockDocumentsService = {
    getStorageServicePublic: jest.fn(),
  };

  beforeAll(async () => {
    // Generate a real OpenPGP key pair to use as a "trusted authority".
    const keyPair = await openpgp.generateKey({
      type: 'ecc',
      curve: 'curve25519',
      userIDs: [{ name: 'Trusted Authority', email: 'trusted@agri-fi.test' }],
      passphrase: '',
    });

    testTrustedKeys.privateKey = await openpgp.decryptKey({
      privateKey: await openpgp.readPrivateKey({
        armoredKey: keyPair.privateKey,
      }),
      passphrase: '',
    });
    testTrustedKeys.publicKey = keyPair.publicKey;
  });

  beforeEach(() => {
    jest.clearAllMocks();

    configService = new ConfigService({
      TRUSTED_AUTHORITY_KEYS: testTrustedKeys.publicKey,
      STELLAR_NETWORK: 'testnet',
      STELLAR_PLATFORM_SECRET: 'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      SIGNING_LINK_TTL_SECONDS: '604800',
      APP_BASE_URL: 'http://localhost:3000',
    });

    jwtService = new JwtService({
      secret: 'test-signing-secret',
      signOptions: { expiresIn: '7d' },
    });

    service = new SignatureRequestService(
      mockRequestRepo as any,
      mockDocumentRepo as any,
      mockUserRepo as any,
      configService,
      jwtService,
      mockStellarService as any,
      mockNotificationsService as any,
      mockDocumentsService as any,
    );
  });

  // ─── Token verification ─────────────────────────────────────────────────────

  describe('verifySigningToken', () => {
    it('accepts a valid, non-expired token that matches the stored hash', async () => {
      const token = jwtService.sign(
        {
          sid: 'req-1',
          doc: 'doc-1',
          cosigner: 'cosigner-1',
          requester: 'requester-1',
          typ: 'signing_link',
        },
        { expiresIn: '1h' },
      );

      const tokenHash = createHash('sha256').update(token).digest('hex');

      mockRequestRepo.findOne.mockResolvedValue({
        id: 'req-1',
        status: 'pending',
        signingTokenHash: tokenHash,
        signingTokenExpiresAt: new Date(Date.now() + 3600_000),
      });

      const result = await service.verifySigningToken(token);

      expect(result).toEqual({
        signatureRequestId: 'req-1',
        documentId: 'doc-1',
        coSignerId: 'cosigner-1',
      });
    });

    it('rejects an expired JWT token', async () => {
      const token = jwtService.sign(
        {
          sid: 'req-1',
          doc: 'doc-1',
          cosigner: 'cosigner-1',
          requester: 'requester-1',
          typ: 'signing_link',
        },
        { expiresIn: '-1s' },
      );

      await expect(service.verifySigningToken(token)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('marks the request as expired when the signing link TTL has elapsed', async () => {
      const request = {
        id: 'req-expired',
        status: 'pending' as SignatureRequestStatus,
        signingTokenHash: createHash('sha256')
          .update('fake-token')
          .digest('hex'),
        signingTokenExpiresAt: new Date(Date.now() - 1000),
      };
      mockRequestRepo.findOne.mockResolvedValue(request);

      // Use a token that would be valid but the DB record says expired.
      const token = jwtService.sign(
        {
          sid: 'req-expired',
          doc: 'doc-1',
          cosigner: 'cosigner-1',
          requester: 'requester-1',
          typ: 'signing_link',
        },
        { expiresIn: '7d' },
      );

      const tokenHash = createHash('sha256').update(token).digest('hex');
      request.signingTokenHash = tokenHash;

      await expect(service.verifySigningToken(token)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(mockRequestRepo.update).toHaveBeenCalledWith('req-expired', {
        status: 'expired',
      });
    });

    it('rejects a token belonging to a non-pending request', async () => {
      const token = jwtService.sign(
        {
          sid: 'req-signed',
          doc: 'doc-1',
          cosigner: 'cosigner-1',
          requester: 'requester-1',
          typ: 'signing_link',
        },
        { expiresIn: '7d' },
      );

      const tokenHash = createHash('sha256').update(token).digest('hex');

      mockRequestRepo.findOne.mockResolvedValue({
        id: 'req-signed',
        status: 'signed',
        signingTokenHash: tokenHash,
        signingTokenExpiresAt: new Date(Date.now() + 3600_000),
      });

      await expect(service.verifySigningToken(token)).rejects.toThrow(
        /no longer pending/,
      );

      expect(mockRequestRepo.update).not.toHaveBeenCalled();
    });

    it('rejects a token whose hash does not match the stored hash', async () => {
      const token = jwtService.sign(
        {
          sid: 'req-1',
          doc: 'doc-1',
          cosigner: 'cosigner-1',
          requester: 'requester-1',
          typ: 'signing_link',
        },
        { expiresIn: '7d' },
      );

      mockRequestRepo.findOne.mockResolvedValue({
        id: 'req-1',
        status: 'pending',
        signingTokenHash: 'mismatched-hash',
        signingTokenExpiresAt: new Date(Date.now() + 3600_000),
      });

      await expect(service.verifySigningToken(token)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a token with the wrong type claim', async () => {
      const token = jwtService.sign(
        {
          sid: 'req-1',
          doc: 'doc-1',
          cosigner: 'cosigner-1',
          requester: 'requester-1',
          typ: 'access',
        },
        { expiresIn: '7d' },
      );

      await expect(service.verifySigningToken(token)).rejects.toThrow(
        /not a signing link/,
      );
    });
  });

  // ─── OpenPGP signature verification ─════════════════════════════════════════

  describe('OpenPGP signature verification', () => {
    it('verifies a valid detached signature against a trusted key', async () => {
      const documentBuffer = Buffer.from('harvest-certification-document');
      const { signatureAsc } = await signWithTrustedKey(documentBuffer);

      const verified = await (service as any).verifyOpenPgpSignature(
        documentBuffer,
        signatureAsc,
      );

      expect(verified).toBe(true);
    });

    it('rejects a signature from an untrusted key when TRUSTED_AUTHORITY_KEYS is set', async () => {
      // Generate a key that is NOT in the trusted list.
      const untrustedKeyPair = await openpgp.generateKey({
        type: 'ecc',
        curve: 'curve25519',
        userIDs: [{ name: 'Untrusted', email: 'untrusted@agri-fi.test' }],
        passphrase: '',
      });

      const docBuffer = Buffer.from('document-bytes');
      const message = await openpgp.message.fromBinary(
        new Uint8Array(docBuffer),
      );
      const { signatures } = await openpgp.sign({
        message,
        privateKeys: [
          await openpgp.decryptKey({
            privateKey: await openpgp.readPrivateKey({
              armoredKey: untrustedKeyPair.privateKey,
            }),
            passphrase: '',
          }),
        ],
      });

      const verified = await (service as any).verifyOpenPgpSignature(
        docBuffer,
        signatures[0].toAsciiArmored(),
      );

      expect(verified).toBe(false);
    });

    it('returns false when TRUSTED_AUTHORITY_KEYS is not configured', async () => {
      const emptyConfigService = new ConfigService({
        TRUSTED_AUTHORITY_KEYS: '',
        STELLAR_NETWORK: 'testnet',
      });
      const emptyService = new SignatureRequestService(
        mockRequestRepo as any,
        mockDocumentRepo as any,
        mockUserRepo as any,
        emptyConfigService,
        jwtService,
        mockStellarService as any,
        mockNotificationsService as any,
        mockDocumentsService as any,
      );

      const docBuffer = Buffer.from('document-bytes');
      const { signatureAsc } = await signWithTrustedKey(docBuffer);

      const verified = await (emptyService as any).verifyOpenPgpSignature(
        docBuffer,
        signatureAsc,
      );

      expect(verified).toBe(false);
    });

    it('returns false for a corrupted / malformed signature string', async () => {
      const docBuffer = Buffer.from('document-bytes');
      const verified = await (service as any).verifyOpenPgpSignature(
        docBuffer,
        '-----BEGIN PGP MESSAGE-----\ninvalid===\n-----END PGP MESSAGE-----',
      );

      expect(verified).toBe(false);
    });
  });

  // ─── processOpenPgpSignature flow ─══════════════════════════════════════════

  describe('processOpenPgpSignature', () => {
    it('marks the request as signed and anchors POE hash on Stellar', async () => {
      const documentBuffer = Buffer.from('co-farmer-agreement-pdf');

      mockDocumentRepo.findOne.mockResolvedValue({
        id: 'doc-1',
        ipfsHash: 'QmTestHash123',
        storageUrl: 'ipfs://QmTestHash123',
        tradeDealId: 'deal-1',
        uploaderId: 'uploader-1',
      });

      mockDocumentsService.getStorageServicePublic.mockReturnValue({
        fetchAndVerifyIpfsDocument: jest
          .fn()
          .mockResolvedValue(documentBuffer),
      });

      const { signatureAsc } = await signWithTrustedKey(documentBuffer);

      const token = jwtService.sign(
        {
          sid: 'req-1',
          doc: 'doc-1',
          cosigner: 'cosigner-1',
          requester: 'requester-1',
          typ: 'signing_link',
        },
        { expiresIn: '7d' },
      );

      mockRequestRepo.findOne.mockResolvedValue({
        id: 'req-1',
        status: 'pending',
        signingTokenHash: createHash('sha256').update(token).digest('hex'),
        signingTokenExpiresAt: new Date(Date.now() + 3600_000),
      });

      mockStellarService.anchorIpfsCid.mockResolvedValue({
        txId: 'stellar-tx-abc',
      });

      const result = await service.processOpenPgpSignature(
        'doc-1',
        token,
        signatureAsc,
      );

      expect(result.status).toBe('signed');
      expect(mockRequestRepo.update).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({
          status: 'signed',
          signatureMethod: 'openpgp',
          stellarTxId: 'stellar-tx-abc',
        }),
      );
      expect(mockStellarService.anchorIpfsCid).toHaveBeenCalled();
    });

    it('revokes the request when the OpenPGP signature is invalid', async () => {
      const documentBuffer = Buffer.from('document-bytes');

      mockDocumentRepo.findOne.mockResolvedValue({
        id: 'doc-1',
        ipfsHash: 'QmTestHash123',
        storageUrl: 'ipfs://QmTestHash123',
        tradeDealId: 'deal-1',
        uploaderId: 'uploader-1',
      });

      mockDocumentsService.getStorageServicePublic.mockReturnValue({
        fetchAndVerifyIpfsDocument: jest
          .fn()
          .mockResolvedValue(documentBuffer),
      });

      // Generate an untrusted key signature.
      const untrustedKeyPair = await openpgp.generateKey({
        type: 'ecc',
        curve: 'curve25519',
        userIDs: [{ name: 'Untrusted', email: 'untrusted@agri-fi.test' }],
        passphrase: '',
      });
      const message = await openpgp.message.fromBinary(
        new Uint8Array(documentBuffer),
      );
      const { signatures } = await openpgp.sign({
        message,
        privateKeys: [
          await openpgp.decryptKey({
            privateKey: await openpgp.readPrivateKey({
              armoredKey: untrustedKeyPair.privateKey,
            }),
            passphrase: '',
          }),
        ],
      });

      const token = jwtService.sign(
        {
          sid: 'req-bad',
          doc: 'doc-1',
          cosigner: 'cosigner-1',
          requester: 'requester-1',
          typ: 'signing_link',
        },
        { expiresIn: '7d' },
      );

      mockRequestRepo.findOne.mockResolvedValue({
        id: 'req-bad',
        status: 'pending',
        signingTokenHash: createHash('sha256').update(token).digest('hex'),
        signingTokenExpiresAt: new Date(Date.now() + 3600_000),
      });

      await expect(
        service.processOpenPgpSignature('doc-1', token, signatures[0].toAsciiArmored()),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockRequestRepo.update).toHaveBeenCalledWith('req-bad', {
        status: 'revoked',
      });
    });

    it('rejects signatures exceeding the 4 KB armored size limit', async () => {
      const token = jwtService.sign(
        {
          sid: 'req-1',
          doc: 'doc-1',
          cosigner: 'cosigner-1',
          requester: 'requester-1',
          typ: 'signing_link',
        },
        { expiresIn: '7d' },
      );

      mockRequestRepo.findOne.mockResolvedValue({
        id: 'req-1',
        status: 'pending',
        signingTokenHash: createHash('sha256').update(token).digest('hex'),
        signingTokenExpiresAt: new Date(Date.now() + 3600_000),
      });

      const hugeSig = 'a'.repeat(4097);

      await expect(
        service.processOpenPgpSignature('doc-1', token, hugeSig),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── createSignatureRequest ─══════════════════════════════════════════════════

  describe('createSignatureRequest', () => {
    it('creates a request with a JWT signing link and notifies the co-signer', async () => {
      mockDocumentRepo.findOne.mockResolvedValue({
        id: 'doc-1',
      });

      mockUserRepo.findOne.mockResolvedValue({
        id: 'cosigner-1',
        email: 'cosigner@example.com',
      });

      mockRequestRepo.create.mockImplementation((dto: any) => dto);
      mockRequestRepo.save.mockImplementation((dto: any) =>
        Promise.resolve({
          ...dto,
          id: 'new-req',
          createdAt: new Date(),
        }),
      );

      const result = await service.createSignatureRequest(
        'doc-1',
        'cosigner-1',
        'requester-1',
      );

      expect(result.id).toBe('new-req');
      expect(result.documentId).toBe('doc-1');
      expect(result.coSignerId).toBe('cosigner-1');
      expect(result.status).toBe('pending');
      expect(result.signingLink).toMatch(/^eyJ/);
      expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'cosigner-1',
          type: 'deal',
        }),
      );
      expect(mockNotificationsService.sendEmail).toHaveBeenCalledWith(
        'cosigner@example.com',
        'Document requires your signature',
        expect.any(String),
        expect.any(String),
      );
    });

    it('stores only the SHA-256 hash of the signing token', async () => {
      mockDocumentRepo.findOne.mockResolvedValue({ id: 'doc-1' });
      mockUserRepo.findOne.mockResolvedValue({
        id: 'cosigner-1',
        email: 'cosigner@example.com',
      });

      mockRequestRepo.create.mockImplementation((dto: any) => dto);
      mockRequestRepo.save.mockImplementation((dto: any) =>
        Promise.resolve({
          ...dto,
          id: 'new-req',
          createdAt: new Date(),
        }),
      );

      const result = await service.createSignatureRequest(
        'doc-1',
        'cosigner-1',
        'requester-1',
      );

      const expectedHash = createHash('sha256')
        .update(result.signingLink)
        .digest('hex');

      expect(mockRequestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          signingTokenHash: expectedHash,
          status: 'pending',
        }),
      );
    });

    it('throws NotFoundException when the document does not exist', async () => {
      mockDocumentRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createSignatureRequest('missing-doc', 'cosigner-1', 'req-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when requester equals co-signer', async () => {
      mockDocumentRepo.findOne.mockResolvedValue({ id: 'doc-1' });

      await expect(
        service.createSignatureRequest('doc-1', 'user-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── revokeSignatureRequest ─═════════════════════════════════════════════════

  describe('revokeSignatureRequest', () => {
    it('revokes a pending request', async () => {
      mockRequestRepo.findOne.mockResolvedValue({
        id: 'req-1',
        status: 'pending',
      });
      mockRequestRepo.findOneOrFail.mockResolvedValue({
        id: 'req-1',
        status: 'revoked',
      });

      const result = await service.revokeSignatureRequest('req-1');

      expect(result.status).toBe('revoked');
      expect(mockRequestRepo.update).toHaveBeenCalledWith('req-1', {
        status: 'revoked',
      });
    });

    it('throws ConflictException when the request is not pending', async () => {
      mockRequestRepo.findOne.mockResolvedValue({
        id: 'req-1',
        status: 'signed',
      });

      await expect(service.revokeSignatureRequest('req-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── getDocumentSignatureRequests ─═══════════════════════════════════════════

  describe('getDocumentSignatureRequests', () => {
    it('returns all requests for a document', async () => {
      mockDocumentRepo.findOne.mockResolvedValue({ id: 'doc-1' });
      const requests = [
        { id: 'req-1', status: 'signed' },
        { id: 'req-2', status: 'pending' },
      ];
      mockRequestRepo.find.mockResolvedValue(requests);

      const result = await service.getDocumentSignatureRequests('doc-1');

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.id)).toEqual(['req-1', 'req-2']);
    });
  });

  // ─── Token expiry with custom TTL ─════════════════════════════════════════════

  describe('token TTL configuration', () => {
    it('honours a custom TTL passed to createSignatureRequest', async () => {
      mockDocumentRepo.findOne.mockResolvedValue({ id: 'doc-1' });
      mockUserRepo.findOne.mockResolvedValue({
        id: 'cosigner-1',
        email: 'cosigner@example.com',
      });
      mockRequestRepo.create.mockImplementation((dto: any) => dto);
      mockRequestRepo.save.mockImplementation((dto: any) =>
        Promise.resolve({
          ...dto,
          id: 'new-req',
          createdAt: new Date(),
        }),
      );

      const customTtl = 3600; // 1 hour
      const result = await service.createSignatureRequest(
        'doc-1',
        'cosigner-1',
        'requester-1',
        customTtl,
      );

      const expectedExpiry = new Date(
        Date.now() + customTtl * 1000,
      );
      const actualExpiry = result.expiresAt.getTime();

      expect(Math.abs(actualExpiry - expectedExpiry.getTime())).toBeLessThan(
        5000, // 5-second tolerance
      );
    });

    it('clamps the TTL to the maximum allowed (30 days)', async () => {
      mockDocumentRepo.findOne.mockResolvedValue({ id: 'doc-1' });
      mockUserRepo.findOne.mockResolvedValue({
        id: 'cosigner-1',
        email: 'cosigner@example.com',
      });
      mockRequestRepo.create.mockImplementation((dto: any) => dto);
      mockRequestRepo.save.mockImplementation((dto: any) =>
        Promise.resolve({
          ...dto,
          id: 'new-req',
          createdAt: new Date(),
        }),
      );

      const result = await service.createSignatureRequest(
        'doc-1',
        'cosigner-1',
        'requester-1',
        9999999, // exceeds max
      );

      const maxExpiry = new Date(
        Date.now() + 30 * 24 * 3600 * 1000,
      );
      const actualExpiry = result.expiresAt.getTime();

      expect(actualExpiry).toBeLessThanOrEqual(maxExpiry.getTime() + 5000);
    });
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  async function signWithTrustedKey(
    documentBuffer: Buffer,
  ): Promise<{ signatureAsc: string }> {
    const message = await openpgp.message.fromBinary(
      new Uint8Array(documentBuffer),
    );
    const { signatures } = await openpgp.sign({
      message,
      privateKeys: [testTrustedKeys.privateKey],
    });
    return { signatureAsc: signatures[0].toAsciiArmored() };
  }
});
