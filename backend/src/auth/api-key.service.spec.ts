import { ApiKeyService } from './api-key.service';
import { Repository } from 'typeorm';
import { ApiKey } from './entities/api-key.entity';

describe('ApiKeyService', () => {
  let service: ApiKeyService;
  let repo: Partial<Repository<ApiKey>>;

  beforeEach(() => {
    repo = {
      create: jest.fn().mockImplementation((dto) => ({
        ...dto,
        id: 'key-uuid',
        createdAt: new Date(),
      })),
      save: jest.fn().mockImplementation((k) => Promise.resolve(k)),
      findOne: jest.fn(),
      find: jest.fn(),
    };
    service = new ApiKeyService(repo as Repository<ApiKey>);
  });

  it('generates a valid agfi_live_ key with sha256 hash', async () => {
    const res = await service.createApiKey('user-1', 'Test Bot', [
      'read:deals',
    ]);
    expect(res.rawKey).toMatch(/^agfi_live_/);
    expect(res.scopes).toEqual(['read:deals']);
  });

  it('hashes key deterministically', () => {
    const hash1 = service.hashKey('agfi_live_sample');
    const hash2 = service.hashKey('agfi_live_sample');
    expect(hash1).toBe(hash2);
  });
});
