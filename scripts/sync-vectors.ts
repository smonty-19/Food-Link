/*
 * Drain vector_sync_outbox once (same worker the app runs every 15 s).
 *   npm run vectors:sync
 */
import "dotenv/config";
import { processOutbox } from "../src/lib/vector-sync";
import { webPool, adminPool } from "../src/lib/db";

async function main() {
  let total = { upserted: 0, deleted: 0 };
  for (;;) {
    const r = await processOutbox(50);
    total = { upserted: total.upserted + r.upserted, deleted: total.deleted + r.deleted };
    if (r.upserted + r.deleted === 0) break;
  }
  console.log(`Outbox drained: ${total.upserted} upserted, ${total.deleted} deleted.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => Promise.all([webPool.end(), adminPool.end()]));
