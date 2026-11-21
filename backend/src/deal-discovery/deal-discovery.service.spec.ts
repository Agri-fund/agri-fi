import { BadRequestException } from '@nestjs/common';
import {
  DealDiscoveryService,
  MAX_SAVED_SEARCHES,
} from './deal-discovery.service';

const openDeal = (id: string, extra: object = {}) => ({
  id,
  commodity: 'Cocoa',
  title: `Deal ${id}`,
  expectedRoi: 15,
  totalInvested: 0,
  totalValue: 100,
  ...extra,
});

function build(deals: any[] = []) {
  const savedRepo: any = {
    count: jest.fn(async () => 0),
    create: jest.fn((d) => ({ id: 's1', ...d })),
    save: jest.fn(async (d) => d),
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const dealRepo: any = { find: jest.fn(async () => deals) };
  const notifications: any = {
    createNotification: jest.fn(async () => ({})),
    sendEmail: jest.fn(async () => undefined),
  };
  const svc = new DealDiscoveryService(
    savedRepo,
    {} as any,
    dealRepo,
    { findOne: jest.fn(async () => ({ email: 'a@b.test' })) } as any,
    notifications,
  );
  return { svc, savedRepo, dealRepo, notifications };
}

describe('DealDiscoveryService', () => {
  it('rejects invalid filters and enforces the saved search cap', async () => {
    const { svc, savedRepo } = build();
    await expect(
      svc.createSaved('u1', { name: 'x', filters: { minRoi: 9, maxRoi: 1 } }),
    ).rejects.toBeInstanceOf(BadRequestException);

    savedRepo.count.mockResolvedValue(MAX_SAVED_SEARCHES);
    await expect(
      svc.createSaved('u1', { name: 'x', filters: { commodity: 'cocoa' } }),
    ).rejects.toThrow(/at most/);
  });

  it('marks deals that already match as seen when a search is saved', async () => {
    const { svc } = build([
      openDeal('d1'),
      openDeal('d2', { commodity: 'Wheat' }),
    ]);
    const saved = await svc.createSaved('u1', {
      name: 'cocoa',
      filters: { commodity: 'cocoa', junk: 1 } as any,
    });
    expect(saved.seenDealIds).toEqual(['d1']);
    expect(saved.filters).toEqual({ commodity: 'cocoa' });
  });

  it('alerts once per new matching deal and not again', async () => {
    const { svc, savedRepo, notifications } = build([
      openDeal('d1'),
      openDeal('d2'),
    ]);
    const search = {
      id: 's1',
      userId: 'u1',
      name: 'cocoa',
      filters: { commodity: 'cocoa' },
      notifyInApp: true,
      notifyEmail: true,
      seenDealIds: ['d1'],
    };
    savedRepo.createQueryBuilder.mockReturnValue({
      where: () => ({ getMany: async () => [search] }),
    });

    expect(await svc.notifyMatches()).toBe(1);
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        metadataJson: expect.objectContaining({ dealIds: ['d2'] }),
      }),
    );
    expect(notifications.sendEmail).toHaveBeenCalledTimes(1);
    expect(search.seenDealIds).toEqual(['d1', 'd2']);

    expect(await svc.notifyMatches()).toBe(0);
  });

  it('compare requires 2-3 distinct UUIDs', async () => {
    const { svc } = build();
    await expect(svc.compare(['a'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.compare(['a', 'b'])).rejects.toThrow(/UUID/);
  });
});
