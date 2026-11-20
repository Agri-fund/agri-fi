import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import { DidController } from './did.controller';
import { DidService } from './did.service';

describe('DidController', () => {
  let controller: DidController;
  let didService: any;

  beforeEach(async () => {
    didService = {
      generateDid: jest.fn(),
      issueCredential: jest.fn(),
      presentCredential: jest.fn(),
      verifyPresentation: jest.fn(),
      revokeCredential: jest.fn(),
      getCredentialStatus: jest.fn(),
      createDid: jest.fn(),
      getDid: jest.fn(),
      updateDid: jest.fn(),
      deactivateDid: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DidController],
      providers: [{ provide: DidService, useValue: didService }],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<DidController>(DidController);
  });

  afterEach(() => jest.clearAllMocks());

  it('should create a persisted DID document for the current user', async () => {
    const dto = { stellarAddress: 'GCREATEADDRESS1234567890ABCDEF1234567890' };
    didService.createDid.mockResolvedValue({
      did: `did:stellar:${dto.stellarAddress}`,
    });

    await expect(controller.createDid('user-1', dto)).resolves.toEqual({
      did: `did:stellar:${dto.stellarAddress}`,
    });
    expect(didService.createDid).toHaveBeenCalledWith(dto, 'user-1');
  });

  it('should read, update and deactivate by DID identifier', async () => {
    const did = 'did:stellar:GCRUDADDRESS1234567890ABCDEF1234567890ABCDEF';

    await controller.getDid(did);
    expect(didService.getDid).toHaveBeenCalledWith(did);

    const dto = { document: { id: did } };
    await controller.updateDid(did, dto, 'user-1');
    expect(didService.updateDid).toHaveBeenCalledWith(did, dto, 'user-1');

    await expect(
      controller.deactivateDid(did, 'user-1'),
    ).resolves.toBeUndefined();
    expect(didService.deactivateDid).toHaveBeenCalledWith(did, 'user-1');
  });
});
