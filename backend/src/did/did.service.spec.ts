import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DidService } from './did.service';
import { DidDocument as DidDocumentEntity } from './entities/did-document.entity';

describe('DidService', () => {
  let service: DidService;
  let didDocumentRepository: any;

  beforeEach(async () => {
    didDocumentRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn((value) => Promise.resolve(value)),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DidService,
        {
          provide: getRepositoryToken(DidDocumentEntity),
          useValue: didDocumentRepository,
        },
      ],
    }).compile();

    service = module.get<DidService>(DidService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should generate a valid W3C compliant DID document for Stellar', () => {
    const stellarAddress =
      'GA2MOCKTESTERWALLET1234567890ABCDEF1234567890ABCDEF1234';
    const didDoc = service.generateDid({ stellarAddress });

    expect(didDoc.id).toBe(`did:stellar:${stellarAddress}`);
    expect(didDoc.verificationMethod[0].controller).toBe(didDoc.id);
    expect(didDoc.authentication[0]).toBe(`${didDoc.id}#keys-1`);
  });

  it('should issue a KYC verifiable credential with on-chain hash anchor', () => {
    const holderDid =
      'did:stellar:GAHOLDER999999999999999999999999999999999999';
    const cred = service.issueCredential({
      holderDid,
      issuerName: 'Agri-Fi Cooperative Central Bank',
      kycLevel: 'TIER_2',
      country: 'NG',
      accreditedInvestor: true,
    });

    expect(cred.id).toMatch(/^urn:uuid:/);
    expect(cred.issuer.name).toBe('Agri-Fi Cooperative Central Bank');
    expect(cred.credentialSubject.id).toBe(holderDid);
    expect(cred.proof.hashAnchor).toBeDefined();
    expect(cred.proof.hashAnchor.length).toBe(64); // SHA-256 length
  });

  it('should create a selective disclosure presentation concealing unrequested fields', () => {
    const holderDid =
      'did:stellar:GAHOLDER999999999999999999999999999999999999';
    const cred = service.issueCredential({
      holderDid,
      issuerName: 'Ministry of Agriculture',
      kycLevel: 'TIER_3',
      country: 'GH',
      accreditedInvestor: false,
    });

    // Request only kycLevel and country
    const presentation = service.presentCredential({
      credentialId: cred.id,
      requestedAttributes: ['kycLevel', 'country'],
      verifierDomain: 'marketplace.agrifi.io',
      challenge: 'random-auth-challenge-12345',
    });

    expect(presentation.holder).toBe(holderDid);
    expect(
      presentation.verifiableCredential[0].credentialSubject.kycLevel,
    ).toBe('TIER_3');
    expect(presentation.verifiableCredential[0].credentialSubject.country).toBe(
      'GH',
    );
    // Ensure unrequested sensitive PII is not included
    expect(
      presentation.verifiableCredential[0].credentialSubject.nationalIdHash,
    ).toBeUndefined();

    // Verification check
    const verification = service.verifyPresentation(presentation);
    expect(verification.valid).toBe(true);
    expect(verification.disclosedAttributes).toEqual(['kycLevel', 'country']);
  });

  it('should reject presentations of revoked credentials', () => {
    const holderDid = 'did:stellar:GAHOLDERREVOKE';
    const cred = service.issueCredential({
      holderDid,
      issuerName: 'Agri-Fi ID Service',
      kycLevel: 'TIER_1',
    });

    service.revokeCredential({
      credentialId: cred.id,
      reason: 'Identity document reported fraudulent',
    });

    const status = service.getCredentialStatus(cred.id);
    expect(status.revoked).toBe(true);

    expect(() => {
      service.presentCredential({
        credentialId: cred.id,
        requestedAttributes: ['kycLevel'],
        verifierDomain: 'portal.agrifi.io',
        challenge: 'test-challenge',
      });
    }).toThrow('has been revoked');
  });

  it('should emit renewal warnings for credentials nearing expiration', () => {
    const holderDid = 'did:stellar:GAHOLDEREXPIRING';
    const cred = service.issueCredential({
      holderDid,
      issuerName: 'Agri-Fi ID Service',
      kycLevel: 'TIER_1',
      expirationDays: 15, // Expires in 15 days
    });

    const presentation = service.presentCredential({
      credentialId: cred.id,
      requestedAttributes: ['kycLevel'],
      verifierDomain: 'portal.agrifi.io',
      challenge: 'test-challenge',
    });

    const verification = service.verifyPresentation(presentation);
    expect(verification.valid).toBe(true);
    expect(verification.warnings).toBeDefined();
    expect(verification.warnings![0]).toContain('expires soon');
  });

  it('should persist a generated DID document with its unique did and controller', async () => {
    const stellarAddress =
      'GA2MOCKTESTERWALLET1234567890ABCDEF1234567890ABCDEF1234';
    const did = `did:stellar:${stellarAddress}`;

    const saved = await service.createDid({ stellarAddress }, 'user-1');

    expect(saved.did).toBe(did);
    expect(saved.controller).toBe('user-1');
    expect(saved.document.id).toBe(did);
    expect(saved.document.verificationMethod[0].controller).toBe(did);
    expect(didDocumentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ did, controller: 'user-1' }),
    );
    expect(didDocumentRepository.save).toHaveBeenCalledTimes(1);
  });

  it('should reject a duplicate did and a missing controller', async () => {
    const stellarAddress = 'GDUPLICATEADDRESS1234567890ABCDEF1234567890ABCDEF';

    await expect(service.createDid({ stellarAddress })).rejects.toThrow(
      /controller user id is required/,
    );

    didDocumentRepository.findOne.mockResolvedValueOnce({
      did: `did:stellar:${stellarAddress}`,
    });
    await expect(
      service.createDid({ stellarAddress }, 'user-1'),
    ).rejects.toThrow(/already exists/);
    expect(didDocumentRepository.save).not.toHaveBeenCalled();
  });

  it('should read a persisted document and throw when it is absent', async () => {
    const did = 'did:stellar:GREADADDRESS1234567890ABCDEF1234567890ABCDEF';
    const record = { did, document: { id: did }, controller: 'user-1' };
    didDocumentRepository.findOne.mockResolvedValueOnce(record);

    await expect(service.getDid(did)).resolves.toEqual(record);

    await expect(service.getDid('did:stellar:GMISSING')).rejects.toThrow(
      /not found/,
    );
  });

  it('should update a persisted document and enforce controller ownership', async () => {
    const did = 'did:stellar:GUPDATEADDRESS1234567890ABCDEF1234567890ABCDEF';
    didDocumentRepository.findOne.mockResolvedValue({
      id: 'record-1',
      did,
      controller: 'user-1',
      document: {
        id: did,
        '@context': ['https://www.w3.org/ns/did/v1'],
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-01T00:00:00.000Z',
      },
    });

    const updated = await service.updateDid(
      did,
      { document: { '@context': ['https://example.org/custom/v1'] } },
      'user-1',
    );

    expect(updated.document['@context']).toEqual([
      'https://example.org/custom/v1',
    ]);
    expect(updated.document.created).toBe('2026-01-01T00:00:00.000Z');
    expect(updated.document.updated).not.toBe('2026-01-01T00:00:00.000Z');
    expect(didDocumentRepository.save).toHaveBeenCalledTimes(1);

    await expect(
      service.updateDid(did, { document: {} }, 'intruder'),
    ).rejects.toThrow(/Only the controller/);
  });

  it('should soft-delete (deactivate) a document and set deactivatedAt', async () => {
    const did = 'did:stellar:GDEACTIVATEADDRESS1234567890ABCDEF1234567890';
    didDocumentRepository.findOne.mockResolvedValue({
      id: 'record-1',
      did,
      controller: 'user-1',
      document: { id: did },
    });

    const result = await service.deactivateDid(did, 'user-1');

    expect(result).toEqual({
      did,
      deactivated: true,
      deactivatedAt: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(result.deactivatedAt))).toBe(false);
    expect(didDocumentRepository.softDelete).toHaveBeenCalledWith({ did });

    await expect(service.deactivateDid(did, 'intruder')).rejects.toThrow(
      /Only the controller/,
    );
  });
});
