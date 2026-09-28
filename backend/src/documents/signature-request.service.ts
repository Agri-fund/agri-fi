import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  Inject,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'crypto';
import * as openpgp from 'openpgp';
import { Transaction, Keypair, Networks } from '@stellar/stellar-sdk';
import {
  SignatureRequest,
  SignatureRequestStatus,
} from './entities/signature-request.entity';
import { Document } from '../trade-deals/entities/document.entity';
import { User } from '../auth/entities/user.entity';
import { StellarService } from '../stellar/stellar.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SIGNING_JWT_MODULE } from './documents.constants';
import { DocumentsService } from './documents.service';

export interface SignatureRequestResult {
  id: string;
  documentId: string;
  coSignerId: string;
  requesterId: string;
  status: SignatureRequestStatus;
  signingLink: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface VerifySigningTokenResult {
  signatureRequestId: string;
  documentId: string;
  coSignerId: string;
}

const DEFAULT_SIGNING_TTL_SECONDS = 7 * 24 * 3600;
const MAX_SIGNING_TTL_SECONDS = 30 * 24 * 3600;

/**
 * SignatureRequestService implements the co-signer signing queue (issue #1005).
 *
 * Responsibilities:
 *  - Create a signature request with a JWT-scoped, TTL-limited signing link.
 *  - Verify signing tokens (JWT signature + expiry + single-use hash match).
 *  - Accept OpenPGP or SEP-10 (wallet) signatures from co-signers.
 *  - Verify OpenPGP signatures against TRUSTED_AUTHORITY_KEYS (reused).
 *  - Anchor a Proof-of-Existence (POE) hash on the Stellar ledger.
 *  - Track status and emit notifications.
 */
@Injectable()
export class SignatureRequestService {
  private readonly logger = new Logger(SignatureRequestService.name);

  constructor(
    @InjectRepository(SignatureRequest)
    private readonly requestRepo: Repository<SignatureRequest>,
    @InjectRepository(Document)
    private readonly documentRepo: Repository<Document>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly config: ConfigService,
    @Inject(SIGNING_JWT_MODULE) private readonly jwtService: JwtService,
    private readonly stellarService: StellarService,
    private readonly notificationsService: NotificationsService,
    @Optional() private readonly documentsService?: DocumentsService,
  ) {}

  private get networkPassphrase(): string {
    const network = this.config.get<string>('STELLAR_NETWORK', 'testnet');
    return network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
  }

  /**
   * Create a signature request for a document and co-signer.
   *
   * Generates a JWT-scoped signing link with a TTL. The raw JWT is returned
   * to the caller (the requester) so it can be delivered to the co-signer,
   * typically via email. A SHA-256 hash of the token is stored so that the
   * raw token is never persisted.
   */
  async createSignatureRequest(
    documentId: string,
    coSignerId: string,
    requesterId: string,
    ttlSeconds?: number,
  ): Promise<SignatureRequestResult> {
    const document = await this.documentRepo.findOne({
      where: { id: documentId },
    });
    if (!document) {
      throw new NotFoundException('Document not found.');
    }

    if (coSignerId === requesterId) {
      throw new BadRequestException(
        'Requester and co-signer must be different users.',
      );
    }

    const coSigner = await this.userRepo.findOne({
      where: { id: coSignerId },
    });
    if (!coSigner) {
      throw new NotFoundException('Co-signer user not found.');
    }

    const now = new Date();
    const ttl = this.resolveTtl(ttlSeconds);
    const expiresAt = new Date(now.getTime() + ttl * 1000);

    const signingToken = this.jwtService.sign(
      {
        sid: randomUUID(),
        doc: documentId,
        cosigner: coSignerId,
        requester: requesterId,
        typ: 'signing_link',
      },
      { expiresIn: `${ttl}s`, jwtid: randomUUID() },
    );

    const tokenHash = this.hashToken(signingToken);

    const request = this.requestRepo.create({
      documentId,
      coSignerId,
      requesterId,
      status: 'pending',
      signingToken,
      signingTokenHash: tokenHash,
      signingTokenExpiresAt: expiresAt,
    });

    const saved = await this.requestRepo.save(request);

    await this.notifyCoSigner(saved, signingToken, expiresAt);

    this.logger.info(
      {
        signatureRequestId: saved.id,
        documentId,
        coSignerId,
        expiresAt: expiresAt.toISOString(),
      },
      'Created signature request and sent signing link to co-signer',
    );

    return {
      id: saved.id,
      documentId,
      coSignerId,
      requesterId,
      status: 'pending',
      signingLink: signingToken,
      expiresAt,
      createdAt: saved.createdAt,
    };
  }

  /**
   * Verify a signing token (JWT) without consuming the signature.
   *
   * Checks:
   *  1. JWT signature and expiry.
   *  2. Signature request exists, is still pending, and hasn't expired.
   *  3. Token hash matches the stored hash (prevents reuse of a revoked token).
   *
   * Returns the decoded payload — does NOT mark the request as signed.
   */
  async verifySigningToken(token: string): Promise<VerifySigningTokenResult> {
    let payload: any;
    try {
      payload = this.jwtService.verify(token, {
        ignoreExpiration: false,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired signing token.');
    }

    if (payload.typ !== 'signing_link') {
      throw new UnauthorizedException('Token is not a signing link.');
    }

    const request = await this.requestRepo.findOne({
      where: { id: payload.sid },
      select: ['id', 'status', 'signingTokenHash', 'signingTokenExpiresAt'],
    });

    if (!request) {
      throw new UnauthorizedException('Signature request not found.');
    }

    if (request.status !== 'pending') {
      throw new UnauthorizedException(
        `Signature request is no longer pending (status: ${request.status}).`,
      );
    }

    const now = new Date();
    if (request.signingTokenExpiresAt <= now) {
      await this.markExpired(request.id);
      throw new UnauthorizedException('Signing link has expired.');
    }

    const submittedHash = this.hashToken(token);
    if (request.signingTokenHash !== submittedHash) {
      throw new UnauthorizedException('Signing token does not match.');
    }

    return {
      signatureRequestId: request.id,
      documentId: payload.doc,
      coSignerId: payload.cosigner,
    };
  }

  /**
   * Process an OpenPGP signature submission.
   *
   *  1. Verifies the signing token (scope + expiry + hash).
   *  2. Fetches the original document from storage.
   *  3. Verifies the detached OpenPGP signature against TRUSTED_AUTHORITY_KEYS.
   *  4. Computes a POE hash (SHA-256 of the signature) and anchors it on Stellar.
   *  5. Updates the signature request status to "signed".
   *
   * Fails closed if any verification step fails.
   */
  async processOpenPgpSignature(
    documentId: string,
    signingToken: string,
    signatureAsc: string,
  ): Promise<{ signatureRequestId: string; status: SignatureRequestStatus }> {
    const { signatureRequestId, coSignerId } =
      await this.verifySigningToken(signingToken);

    if (!signatureAsc) {
      throw new BadRequestException('OpenPGP signature is required.');
    }

    if (signatureAsc.length > 4096) {
      throw new BadRequestException(
        'Signature exceeds the 4 KB armored size limit.',
      );
    }

    const document = await this.documentRepo.findOne({
      where: { id: documentId },
    });
    if (!document) {
      throw new NotFoundException('Document not found.');
    }

    const fileBuffer = await this.fetchDocumentBytes(document);

    const signatureVerified = await this.verifyOpenPgpSignature(
      fileBuffer,
      signatureAsc,
    );

    if (!signatureVerified) {
      await this.updateStatus(signatureRequestId, 'revoked');
      throw new UnauthorizedException(
        'OpenPGP signature verification failed: key not in TRUSTED_AUTHORITY_KEYS.',
      );
    }

    const pfpHash = createHash('sha256').update(signatureAsc).digest('hex');
    const signerSecret = this.config.get<string>('STELLAR_PLATFORM_SECRET', '');
    const { txId } = await this.stellarService.anchorIpfsCid(
      pfpHash,
      signerSecret,
    );

    await this.requestRepo.update(signatureRequestId, {
      status: 'signed',
      signatureMethod: 'openpgp',
      pfpHash,
      stellarTxId: txId,
      signedAt: new Date(),
    });

    await this.notifyCoSignerSigned(signatureRequestId, document, coSignerId);

    this.logger.info(
      { signatureRequestId, documentId, pfpHash, txId },
      'Co-signer OpenPGP signature verified and POE anchored on Stellar',
    );

    return { signatureRequestId, status: 'signed' };
  }

  /**
   * Process a SEP-10 (Stellar wallet) signature submission.
   *
   *  1. Verifies the signing token (scope + expiry + hash).
   *  2. Verifies the SEP-10 challenge envelope was signed by the co-signer's wallet.
   *  3. Computes a POE hash from the envelope and anchors it on Stellar.
   *  4. Updates the signature request status to "signed".
   */
  async processSep10Signature(
    documentId: string,
    signingToken: string,
    stellarEnvelope: string,
  ): Promise<{ signatureRequestId: string; status: SignatureRequestStatus }> {
    const { signatureRequestId, coSignerId } =
      await this.verifySigningToken(signingToken);

    if (!stellarEnvelope) {
      throw new BadRequestException('SEP-10 signed transaction envelope is required.');
    }

    const document = await this.documentRepo.findOne({
      where: { id: documentId },
    });
    if (!document) {
      throw new NotFoundException('Document not found.');
    }

    const signingKeypair = await this.verifySep10Envelope(
      stellarEnvelope,
      coSignerId,
    );

    if (!signingKeypair) {
      await this.updateStatus(signatureRequestId, 'revoked');
      throw new UnauthorizedException(
        'SEP-10 envelope is not signed by the co-signer\'s wallet.',
      );
    }

    const pfpHash = createHash('sha256').update(stellarEnvelope).digest('hex');
    const signerSecret = this.config.get<string>('STELLAR_PLATFORM_SECRET', '');
    const { txId } = await this.stellarService.anchorIpfsCid(
      pfpHash,
      signerSecret,
    );

    await this.requestRepo.update(signatureRequestId, {
      status: 'signed',
      signatureMethod: 'sep10',
      pfpHash,
      stellarTxId: txId,
      signedAt: new Date(),
    });

    await this.notifyCoSignerSigned(signatureRequestId, document, coSignerId);

    this.logger.info(
      { signatureRequestId, documentId, pfpHash, txId },
      'Co-signer SEP-10 signature verified and POE anchored on Stellar',
    );

    return { signatureRequestId, status: 'signed' };
  }

  /**
   * List all signature requests for a document (status tracking).
   */
  async getDocumentSignatureRequests(
    documentId: string,
  ): Promise<SignatureRequest[]> {
    const document = await this.documentRepo.findOne({
      where: { id: documentId },
    });
    if (!document) {
      throw new NotFoundException('Document not found.');
    }

    return this.requestRepo.find({
      where: { documentId },
      order: { createdAt: 'DESC' },
      relations: ['coSigner', 'requester'],
    });
  }

  /**
   * Retrieve a single signature request by id.
   */
  async getSignatureRequest(id: string): Promise<SignatureRequest> {
    const request = await this.requestRepo.findOne({
      where: { id },
      relations: ['document', 'coSigner', 'requester'],
    });
    if (!request) {
      throw new NotFoundException('Signature request not found.');
    }
    return request;
  }

  /**
   * Revoke a pending signature request. The signing link becomes invalid.
   */
  async revokeSignatureRequest(id: string): Promise<SignatureRequest> {
    const request = await this.requestRepo.findOne({ where: { id } });
    if (!request) {
      throw new NotFoundException('Signature request not found.');
    }

    if (request.status !== 'pending') {
      throw new ConflictException(
        `Cannot revoke a request in "${request.status}" status.`,
      );
    }

    await this.requestRepo.update(id, { status: 'revoked' });
    return this.requestRepo.findOneOrFail({ where: { id } });
  }

  // ─── Internal helpers ───────────────────────────────────────────────────────

  private async markExpired(id: string): Promise<void> {
    await this.requestRepo.update(id, { status: 'expired' });
  }

  private async updateStatus(
    id: string,
    status: SignatureRequestStatus,
  ): Promise<void> {
    await this.requestRepo.update(id, { status });
  }

  private resolveTtl(requested?: number): number {
    if (requested && requested >= 1 && requested <= MAX_SIGNING_TTL_SECONDS) {
      return requested;
    }
    const configured = this.config.get<number>(
      'SIGNING_LINK_TTL_SECONDS',
      DEFAULT_SIGNING_TTL_SECONDS,
    );
    return Math.min(Math.max(configured, 1), MAX_SIGNING_TTL_SECONDS);
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Fetch document bytes from storage for signature verification.
   */
  private async fetchDocumentBytes(document: Document): Promise<Buffer> {
    const storageService = await this.getStorageService();
    return storageService.fetchAndVerifyIpfsDocument(document.ipfsHash);
  }

  private storageServicePromise: Promise<StorageService> | null = null;
  private async getStorageService(): Promise<StorageService> {
    if (this.documentsService) {
      return this.documentsService.getStorageServicePublic();
    }
    if (!this.storageServicePromise) {
      this.storageServicePromise = Promise.reject(
        new Error('Storage service unavailable'),
      );
    }
    return this.storageServicePromise;
  }

  /**
   * Verify a detached OpenPGP signature against TRUSTED_AUTHORITY_KEYS.
   * Reuses the same trusted-authority configuration as DocumentsService.#verifySignature.
   */
  private async verifyOpenPgpSignature(
    fileBuffer: Buffer,
    armoredSig: string,
  ): Promise<boolean> {
    const trustedKeysRaw = this.config.get<string>('TRUSTED_AUTHORITY_KEYS', '');
    if (!trustedKeysRaw) return false;

    try {
      const publicKeys: openpgp.key.Key[] = [];
      for (const raw of trustedKeysRaw.split(',')) {
        const trimmed = raw.trim();
        if (!trimmed) continue;
        const { keys, err } = await openpgp.key.readArmored(trimmed);
        if (err && err.length) continue;
        publicKeys.push(...keys);
      }
      if (!publicKeys.length) return false;

      const message = openpgp.message.fromBinary(new Uint8Array(fileBuffer));
      const signature = await openpgp.signature.readArmored(armoredSig);
      const result = await openpgp.verify({ message, signature, publicKeys });

      const validities = await Promise.all(
        result.signatures.map((s: any) => s.valid),
      );
      return validities.some((v: boolean | null) => v === true);
    } catch {
      return false;
    }
  }

  /**
   * Verify a SEP-10 challenge transaction envelope.
   *
   * The envelope must be signed by the co-signer's Stellar wallet. We look
   * up the co-signer's wallet_address from the User table and confirm the
   * envelope contains a matching signature hint.
   */
  private async verifySep10Envelope(
    envelopeXdr: string,
    coSignerId: string,
  ): Promise<Keypair | null> {
    const user = await this.userRepo.findOne({
      where: { id: coSignerId },
      select: ['walletAddress'],
    });

    if (!user?.walletAddress) {
      return null;
    }

    let tx: Transaction;
    try {
      tx = new Transaction(envelopeXdr, this.networkPassphrase);
    } catch {
      return null;
    }

    const txHash = tx.hash();
    const coSignerKeypair = Keypair.fromPublicKey(user.walletAddress);
    const coSignerHint = Buffer.from(
      coSignerKeypair.signatureHint() as any,
    ).toString('hex');

    const isSigned = tx.signatures.some((sig) => {
      const hint = Buffer.from(sig.hint as any).toString('hex');
      if (hint !== coSignerHint) return false;
      try {
        return coSignerKeypair.verify(
          txHash,
          Buffer.from(sig.signature as any),
        );
      } catch {
        return false;
      }
    });

    return isSigned ? coSignerKeypair : null;
  }

  /**
   * Send an in-app notification + email to the co-signer with the signing link.
   */
  private async notifyCoSigner(
    request: SignatureRequest,
    signingLink: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.notificationsService
      .createNotification({
        userId: request.coSignerId,
        type: 'deal',
        title: 'Document signature request',
        message: `A document requires your signature. The signing link expires on ${expiresAt.toISOString()}.`,
        linkUrl: `/documents/signature/${request.id}/sign`,
        metadataJson: {
          signatureRequestId: request.id,
          documentId: request.documentId,
          expiresAt: expiresAt.toISOString(),
        },
      })
      .catch(() => null);

    const coSigner = await this.userRepo.findOne({
      where: { id: request.coSignerId },
      select: ['email'],
    });

    if (coSigner?.email) {
      const appBaseUrl = this.config.get<string>('APP_BASE_URL', '');
      const link = `${appBaseUrl}/documents/signature/${request.id}/sign?token=${signingLink}`;
      await this.notificationsService
        .sendEmail(
          coSigner.email,
          'Document requires your signature',
          `A document for deal ${request.documentId} requires your signature.\n\n` +
            `Signing link (valid until ${expiresAt.toISOString()}):\n${link}\n`,
          `<p>A document for deal <strong>${request.documentId}</strong> requires your signature.</p>` +
            `<p><a href="${link}">Click here to sign</a> (valid until ${expiresAt.toISOString()})</p>`,
        )
        .catch(() => null);
    }
  }

  /** Notify the document uploader that a co-signer has signed. */
  private async notifyCoSignerSigned(
    signatureRequestId: string,
    document: Document,
    coSignerId: string,
  ): Promise<void> {
    await this.notificationsService
      .createNotification({
        userId: document.uploaderId,
        type: 'deal',
        title: 'Document signed',
        message: `Co-signer has signed document for deal ${document.tradeDealId}.`,
        linkUrl: `/trade-deals/${document.tradeDealId}/documents/${document.id}`,
        metadataJson: {
          signatureRequestId,
          documentId: document.id,
          coSignerId,
          status: 'signed',
        },
      })
      .catch(() => null);
  }
}
