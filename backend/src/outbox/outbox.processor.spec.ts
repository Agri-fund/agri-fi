import { OutboxProcessor } from './outbox.processor';

/** Minimal in-memory stand-in for the Redis commands the lease uses. */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    isOpen: true,
    set: async (k: string, v: string, o: { NX: boolean }) => {
      if (o.NX && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    },
    eval: async (_s: string, o: { keys: string[]; arguments: string[] }) => {
      if (store.get(o.keys[0]) === o.arguments[0]) store.delete(o.keys[0]);
    },
  };
}

describe('OutboxProcessor lease', () => {
  it('does not publish the same rows from two replicas running concurrently', async () => {
    const redis = fakeRedis();
    const published: string[] = [];
    const rows = [{ id: 'e1', eventType: 't', payload: {}, retryCount: 0 }];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const outbox: any = {
      publishPending: async () => {
        await gate; // hold replica A inside its critical section
        return rows;
      },
      markProcessed: async () => undefined,
    };
    const logger: any = {
      setContext: jest.fn(),
      trace: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
    const make = () => {
      const counter = { inc: jest.fn() };
      const p: any = new OutboxProcessor(
        outbox,
        {} as any,
        logger,
        redis as any,
        counter as any,
        { set: jest.fn() } as any,
      );
      p.processEvent = async (e: any) => void published.push(e.id);
      return { p, counter };
    };

    const a = make();
    const b = make();
    const first = a.p.processOutbox();
    await new Promise((r) => setImmediate(r));
    await b.p.processOutbox(); // lease held by A, must skip
    release();
    await first;

    expect(published).toEqual(['e1']);
    expect(b.counter.inc).toHaveBeenCalledTimes(1);
  });
});
