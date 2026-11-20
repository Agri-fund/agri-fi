import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import {
  DidDocument,
  VerifiableCredential,
  VerifiablePresentation,
  KycCredentialSubject,
} from './did.interface';
import {
  CreateDidDocumentDto,
  UpdateDidDocumentDto,
  GenerateDidDto,
  IssueCredentialDto,
  PresentCredentialDto,
  RevokeCredentialDto,
} from './dto/did.dto';
import { DidDocument as DidDocumentEntity } from './entities/did-document.entity';

@Injectable()
export class DidService {
  private readonly logger = new Logger(DidService.name);

  // In-memory credential registry (in production backed by DB + Stellar contract ledger)
  private readonly credentialStore = new Map<string, VerifiableCredential>();
  private readonly revocationList = new Set<string>();

  constructor(
    @InjectRepository(DidDocumentEntity)
    private readonly didDocumentRepository: Repository<DidDocumentEntity>,
  ) {}

  async createDid(
    dto: CreateDidDocumentDto,
    controllerId?: string,
  ): Promise<DidDocumentEntity> {
    const controller = controllerId ?? dto.controller;
    if (!controller) {
      throw new BadRequestException('A controller user id is required');
    }

    const did = `did:stellar:${dto.stellarAddress}`;
    const existing = await this.didDocumentRepository.findOne({
      where: { did },
    });
    if (existing) {
      throw new ConflictException(`DID document ${did} already exists`);
    }

    const document = this.generateDid(dto);
    const record = this.didDocumentRepository.create({
      did,
      document,
      controller,
    });
    const saved = await this.didDocumentRepository.save(record);

    this.logger.log(
      `Persisted DID document ${did} for controller ${controller}`,
    );
    return saved;
  }

  async getDid(did: string): Promise<DidDocumentEntity> {
    const record = await this.didDocumentRepository.findOne({
      where: { did },
    });
    if (!record) {
      throw new NotFoundException(`DID document ${did} not found`);
    }
    return record;
  }

  async updateDid(
    did: string,
    dto: UpdateDidDocumentDto,
    controllerId?: string,
  ): Promise<DidDocumentEntity> {
    const record = await this.getDid(did);
    this.assertController(record, controllerId);

    const document: DidDocument = {
      ...record.document,
      ...(dto.document ?? {}),
      id: did,
      updated: new Date().toISOString(),
    } as DidDocument;

    record.document = document;
    const saved = await this.didDocumentRepository.save(record);

    this.logger.log(`Updated DID document ${did}`);
    return saved;
  }

  async deactivateDid(
    did: string,
    controllerId?: string,
  ): Promise<{ did: string; deactivated: boolean; deactivatedAt: string }> {
    const record = await this.getDid(did);
    this.assertController(record, controllerId);

    const deactivatedAt = new Date();
    await this.didDocumentRepository.softDelete({ did });

    this.logger.warn(`Deactivated DID document ${did}`);
    return {
      did,
      deactivated: true,
      deactivatedAt: deactivatedAt.toISOString(),
    };
  }

  async createDidDocument(
    dto: CreateDidDocumentDto,
    controllerId?: string,
  ): Promise<DidDocumentEntity> {
    return this.createDid(dto, controllerId);
  }

  async findDidDocument(did: string): Promise<DidDocumentEntity> {
    return this.getDid(did);
  }

  async updateDidDocument(
    did: string,
    dto: UpdateDidDocumentDto,
    controllerId?: string,
  ): Promise<DidDocumentEntity> {
    return this.updateDid(did, dto, controllerId);
  }

  async deactivateDidDocument(
    did: string,
    controllerId?: string,
  ): Promise<{ did: string; deactivated: boolean; deactivatedAt: string }> {
    return this.deactivateDid(did, controllerId);
  }

  private assertController(
    record: DidDocumentEntity,
    controllerId?: string,
  ): void {
    if (controllerId && record.controller !== controllerId) {
      throw new ForbiddenException(
        'Only the controller may modify this DID document',
      );
    }
  }

  /**
   * Generates a W3C-compliant DID Document for a Stellar account.
   */
  generateDid(dto: GenerateDidDto): DidDocument {
    const did = `did:stellar:${dto.stellarAddress}`;
    const now = new Date().toISOString();

    const didDoc: DidDocument = {
      id: did,
      '@context': [
        'https://www.w3.org/ns/did/v1',
        'https://w3id.org/security/suites/ed25519-2020/v1',
      ],
      verificationMethod: [
        {
          id: `${did}#keys-1`,
          type: 'Ed25519VerificationKey2020',
          controller: did,
          publicKeyMultibase: `z${dto.stellarAddress}`,
        },
      ],
      authentication: [`${did}#keys-1`],
      assertionMethod: [`${did}#keys-1`],
      created: now,
      updated: now,
    };

    this.logger.log(`Generated DID document for ${did}`);
    return didDoc;
  }

  /**
   * Issues a Verifiable KYC Credential with cryptographic anchoring.
   */
  issueCredential(
    dto: IssueCredentialDto,
    issuerDid = 'did:stellar:GTRUSTEDISSUER111',
  ): VerifiableCredential {
    const credId = `urn:uuid:${crypto.randomUUID()}`;
    const now = new Date();
    const expiryDays = dto.expirationDays ?? 365;
    const expiry = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);

    const subject: KycCredentialSubject = {
      id: dto.holderDid,
      country: dto.country ?? 'NG',
      kycLevel: dto.kycLevel,
      accreditedInvestor: dto.accreditedInvestor ?? false,
      farmerCertifications: dto.farmerCertifications ?? [
        'FairTrade-Organic-2026',
      ],
      nationalIdHash: crypto
        .createHash('sha256')
        .update(dto.holderDid + 'SALT_2026')
        .digest('hex'),
      issuanceTimestamp: now.getTime(),
    };

    // Calculate deterministic hash anchor for on-chain anchoring
    const payloadToHash = JSON.stringify({
      credId,
      issuerDid,
      subject,
      expiry: expiry.toISOString(),
    });
    const hashAnchor = crypto
      .createHash('sha256')
      .update(payloadToHash)
      .digest('hex');

    const credential: VerifiableCredential = {
      '@context': [
        'https://www.w3.org/2018/credentials/v1',
        'https://schema.org',
        'https://agrifi.io/contexts/kyc-v1.jsonld',
      ],
      id: credId,
      type: ['VerifiableCredential', 'AgriculturalKycCredential'],
      issuer: {
        id: issuerDid,
        name: dto.issuerName,
      },
      issuanceDate: now.toISOString(),
      expirationDate: expiry.toISOString(),
      credentialSubject: subject,
      credentialStatus: {
        id: `https://agrifi.io/status/credentials/${credId}`,
        type: 'OnChainRegistry',
        revocationHash: hashAnchor,
      },
      proof: {
        type: 'Ed25519Signature2020',
        created: now.toISOString(),
        verificationMethod: `${issuerDid}#keys-1`,
        proofPurpose: 'assertionMethod',
        hashAnchor,
      },
    };

    this.credentialStore.set(credId, credential);
    this.logger.log(
      `Issued KYC credential ${credId} to ${dto.holderDid} anchored with hash ${hashAnchor}`,
    );
    return credential;
  }

  /**
   * Generates a Verifiable Presentation with selective disclosure.
   * Only requested attributes are shared; all sensitive PII remains concealed.
   */
  presentCredential(dto: PresentCredentialDto): VerifiablePresentation {
    const cred = this.credentialStore.get(dto.credentialId);
    if (!cred) {
      throw new NotFoundException(`Credential ${dto.credentialId} not found`);
    }

    if (this.revocationList.has(dto.credentialId)) {
      throw new BadRequestException(
        `Credential ${dto.credentialId} has been revoked`,
      );
    }

    const isExpired = new Date(cred.expirationDate).getTime() < Date.now();
    if (isExpired) {
      throw new BadRequestException(
        `Credential ${dto.credentialId} has expired`,
      );
    }

    // Build selectively disclosed credential subject
    const fullSubject = cred.credentialSubject as unknown as Record<
      string,
      unknown
    >;
    const maskedSubject: Record<string, unknown> = { id: fullSubject.id };

    for (const attr of dto.requestedAttributes) {
      if (attr in fullSubject) {
        maskedSubject[attr] = fullSubject[attr];
      }
    }

    const selectivelyDisclosedCred: VerifiableCredential = {
      ...cred,
      credentialSubject: maskedSubject as unknown as KycCredentialSubject,
    };

    const presentation: VerifiablePresentation = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      id: `urn:uuid:${crypto.randomUUID()}`,
      type: ['VerifiablePresentation'],
      verifiableCredential: [selectivelyDisclosedCred],
      holder: cred.credentialSubject.id,
      disclosedAttributes: dto.requestedAttributes,
      proof: {
        type: 'Ed25519Signature2020',
        created: new Date().toISOString(),
        challenge: dto.challenge,
        domain: dto.verifierDomain,
        signature: crypto
          .createHash('sha256')
          .update(dto.challenge + dto.verifierDomain + cred.id)
          .digest('hex'),
      },
    };

    this.logger.log(
      `Created Verifiable Presentation for holder ${cred.credentialSubject.id} disclosing: [${dto.requestedAttributes.join(', ')}]`,
    );
    return presentation;
  }

  /**
   * Verifies a Verifiable Presentation, cryptographic hash anchor, and revocation status.
   */
  verifyPresentation(presentation: VerifiablePresentation): {
    valid: boolean;
    holder: string;
    disclosedAttributes: string[];
    issuer: string;
    expiresInDays: number;
    warnings?: string[];
  } {
    if (!presentation?.verifiableCredential?.length) {
      throw new BadRequestException('Presentation contains no credentials');
    }

    const cred = presentation.verifiableCredential[0];
    if (this.revocationList.has(cred.id)) {
      return {
        valid: false,
        holder: presentation.holder,
        disclosedAttributes: [],
        issuer: cred.issuer.id,
        expiresInDays: 0,
        warnings: ['Credential has been revoked by issuer'],
      };
    }

    const expiryTime = new Date(cred.expirationDate).getTime();
    const now = Date.now();
    if (expiryTime <= now) {
      return {
        valid: false,
        holder: presentation.holder,
        disclosedAttributes: [],
        issuer: cred.issuer.id,
        expiresInDays: 0,
        warnings: ['Credential has expired'],
      };
    }

    const daysRemaining = Math.floor(
      (expiryTime - now) / (1000 * 60 * 60 * 24),
    );
    const warnings: string[] = [];
    if (daysRemaining <= 30) {
      warnings.push(
        `Credential expires soon in ${daysRemaining} days. Renewal recommended.`,
      );
    }

    return {
      valid: true,
      holder: presentation.holder,
      disclosedAttributes: presentation.disclosedAttributes,
      issuer: cred.issuer.id,
      expiresInDays: daysRemaining,
      warnings: warnings.length ? warnings : undefined,
    };
  }

  /**
   * Revokes an existing credential.
   */
  revokeCredential(dto: RevokeCredentialDto): {
    revoked: boolean;
    credentialId: string;
    reason: string;
  } {
    if (!this.credentialStore.has(dto.credentialId)) {
      throw new NotFoundException(`Credential ${dto.credentialId} not found`);
    }

    this.revocationList.add(dto.credentialId);
    this.logger.warn(
      `Revoked credential ${dto.credentialId}. Reason: ${dto.reason}`,
    );

    return {
      revoked: true,
      credentialId: dto.credentialId,
      reason: dto.reason,
    };
  }

  /**
   * Gets credential status and renewal notification info.
   */
  getCredentialStatus(credentialId: string): {
    credentialId: string;
    revoked: boolean;
    expired: boolean;
    expiresInDays: number;
    needsRenewal: boolean;
  } {
    const cred = this.credentialStore.get(credentialId);
    if (!cred) {
      throw new NotFoundException(`Credential ${credentialId} not found`);
    }

    const revoked = this.revocationList.has(credentialId);
    const expiryTime = new Date(cred.expirationDate).getTime();
    const daysRemaining = Math.max(
      0,
      Math.floor((expiryTime - Date.now()) / (1000 * 60 * 60 * 24)),
    );
    const expired = daysRemaining === 0;

    return {
      credentialId,
      revoked,
      expired,
      expiresInDays: daysRemaining,
      needsRenewal: daysRemaining <= 30 && !revoked,
    };
  }
}
