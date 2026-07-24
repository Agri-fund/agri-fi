/**
 * Requeue messages from a dead-letter queue back onto its primary queue.
 *
 * Usage:
 *   npx ts-node scripts/retry-dlq.ts main            # requeue agric_onchain_queue.dlq
 *   npx ts-node scripts/retry-dlq.ts escrow           # requeue agric_onchain_escrow_queue.dlq
 *   npx ts-node scripts/retry-dlq.ts main --limit=10  # requeue at most 10 messages
 *   npx ts-node scripts/retry-dlq.ts main --peek      # inspect without requeueing
 *
 * Env: RABBITMQ_URL (default amqp://guest:guest@localhost:5672)
 */
import * as amqp from 'amqplib';
import {
  MAIN_QUEUE_NAME,
  MAIN_QUEUE_DLQ,
  ESCROW_QUEUE_NAME,
  ESCROW_QUEUE_DLQ,
} from '../src/queue/queue.dlq.constants';

const TARGETS: Record<string, { queue: string; dlq: string }> = {
  main: { queue: MAIN_QUEUE_NAME, dlq: MAIN_QUEUE_DLQ },
  escrow: { queue: ESCROW_QUEUE_NAME, dlq: ESCROW_QUEUE_DLQ },
};

async function main() {
  const [target, ...flags] = process.argv.slice(2);
  const config = TARGETS[target];
  if (!config) {
    console.error(
      `Usage: ts-node scripts/retry-dlq.ts <${Object.keys(TARGETS).join('|')}> [--limit=N] [--peek]`,
    );
    process.exit(1);
  }

  const peek = flags.includes('--peek');
  const limitFlag = flags.find((f) => f.startsWith('--limit='));
  const limit = limitFlag ? parseInt(limitFlag.split('=')[1], 10) : Infinity;

  const url = process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';
  const connection = await amqp.connect(url);
  const channel = await connection.createChannel();

  const { messageCount } = await channel.checkQueue(config.dlq);
  console.log(`${config.dlq}: ${messageCount} message(s) pending`);

  let processed = 0;
  while (processed < limit && processed < messageCount) {
    const msg = await channel.get(config.dlq, { noAck: false });
    if (!msg) break;

    const preview = msg.content.toString('utf8').slice(0, 200);
    console.log(`[${processed + 1}] ${peek ? 'peek' : 'requeue'}: ${preview}`);

    if (peek) {
      // Put it back rather than consuming it.
      channel.nack(msg, false, true);
    } else {
      channel.sendToQueue(config.queue, msg.content, {
        persistent: true,
        headers: msg.properties.headers,
      });
      channel.ack(msg);
    }
    processed++;
  }

  console.log(
    `Done. ${peek ? 'Inspected' : 'Requeued'} ${processed} message(s).`,
  );
  await channel.close();
  await connection.close();
}

main().catch((err) => {
  console.error('retry-dlq failed:', err.message);
  process.exit(1);
});
