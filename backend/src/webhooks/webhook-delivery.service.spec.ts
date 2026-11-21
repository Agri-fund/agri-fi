import { of, throwError } from 'rxjs';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { MAX_RETRIES, nextRetryDelayMs } from './webhook-retry';

const sub = {
  id: 's1',
  url: 'https://x.test/hook',
  secret: 'sec',
  events: ['deal.funded'],
  isActive: true,
};

function build(post: jest.Mock, rateLimit = 60) {
  const deliveryRepo: any = {
    save: jest.fn(async (d) => d),
    create: jest.fn((d) => ({ id: 'd1', ...d })),
    findOne: jest.fn(),
  };
  const subRepo: any = {
    find: jest.fn(async () => [sub]),
    findOne: jest.fn(async () => sub),
  };
  const config: any = { get: (_k: string, d: unknown) => rateLimit ?? d };
  const svc = new WebhookDeliveryService(
    deliveryRepo,
    subRepo,
    { post } as any,
    config,
  );
  return { svc, deliveryRepo };
}

const fresh = () =>
  ({
    id: 'd1',
    subscriptionId: 's1',
    event: 'deal.funded',
    payload: '{"a":1}',
    status: 'pending',
    attemptCount: 0,
    attempts: [],
  }) as any;

describe('nextRetryDelayMs', () => {
  it('follows 1m, 5m, 15m, 1h, 4h, 4h and then dead-letters', () => {
    const mins = [1, 2, 3, 4, 5, 6].map((n) => nextRetryDelayMs(n)! / 60000);
    expect(mins).toEqual([1, 5, 15, 60, 240, 240]);
    expect(nextRetryDelayMs(MAX_RETRIES + 1)).toBeNull();
  });
});

describe('WebhookDeliveryService', () => {
  it('signs the payload and marks the delivery delivered on 2xx', async () => {
    const post = jest.fn(() => of({ status: 200 }));
    const { svc } = build(post as any);
    const d = await svc.attempt(fresh());

    expect(d.status).toBe('delivered');
    expect(d.attempts).toHaveLength(1);
    expect(post).toHaveBeenCalledWith(
      sub.url,
      '{"a":1}',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-webhook-signature': svc.sign('{"a":1}', 'sec'),
        }),
      }),
    );
  });

  it('schedules a retry on failure and records the response code', async () => {
    const post = jest.fn(() =>
      throwError(() => ({ response: { status: 500 } })),
    );
    const { svc } = build(post as any);
    const d = await svc.attempt(fresh());

    expect(d.status).toBe('retrying');
    expect(d.lastStatusCode).toBe(500);
    expect(d.attempts[0]).toMatchObject({ attempt: 1, statusCode: 500 });
    expect(d.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  it('moves the delivery to the DLQ after the retries are exhausted', async () => {
    const post = jest.fn(() => throwError(() => new Error('down')));
    const { svc } = build(post as any);
    const d = fresh();
    d.attemptCount = MAX_RETRIES; // next failure is attempt 7
    const res = await svc.attempt(d);

    expect(res.status).toBe('failed');
    expect(res.nextAttemptAt).toBeNull();
  });

  it('defers without consuming an attempt when rate limited', async () => {
    const post = jest.fn(() => of({ status: 200 }));
    const { svc } = build(post as any, 1);
    await svc.attempt(fresh());
    const second = await svc.attempt(fresh());

    expect(post).toHaveBeenCalledTimes(1);
    expect(second.attemptCount).toBe(0);
    expect(second.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('replay only accepts failed deliveries', async () => {
    const { svc, deliveryRepo } = build(jest.fn(() => of({ status: 200 })));
    deliveryRepo.findOne.mockResolvedValue({ ...fresh(), status: 'delivered' });
    await expect(svc.replay('d1')).rejects.toThrow('Only failed');

    deliveryRepo.findOne.mockResolvedValue({
      ...fresh(),
      status: 'failed',
      attemptCount: 7,
    });
    const d = await svc.replay('d1');
    expect(d.status).toBe('delivered');
  });
});
