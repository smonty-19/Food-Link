import type { PoolClient } from "pg";
import { webPool } from "./db";
import { donationText, embed } from "./embed";
import { deleteVector, ensureCollection, upsertVector } from "./qdrant";

/*
 * Transactional outbox consumer.
 *
 * Triggers in review2.sql (A.T3, A.T4) write UPSERT / DELETE rows into
 * vector_sync_outbox in the SAME transaction as the donation change, so the
 * queue can never miss a change that committed. This worker drains it.
 *
 * FOR UPDATE SKIP LOCKED lets several workers (the background job, the admin
 * button, the CLI script) run at once without processing a row twice and
 * without blocking each other.
 */

type OutboxRow = { outbox_id: string; donation_id: string; op: "UPSERT" | "DELETE" };
type DonationRow = { description: string; items: string | null; dietary_tags: string[] | null; status: string };

const LIVE = new Set(["AVAILABLE", "ALLOCATED"]); // ALLOCATED can return to AVAILABLE

async function loadDonation(client: PoolClient, id: string) {
  const res = await client.query<DonationRow>(
    `SELECT d.description, d.dietary_tags, d.status::text AS status,
            (SELECT string_agg(f.name, ', ' ORDER BY f.name) FROM food_items f
              WHERE f.donation_id = d.donation_id) AS items
       FROM donations d WHERE d.donation_id = $1`,
    [id],
  );
  return res.rows[0];
}

export async function processOutbox(batch = 25): Promise<{ upserted: number; deleted: number }> {
  const client = await webPool.connect();
  let upserted = 0;
  let deleted = 0;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<OutboxRow>(
      `SELECT outbox_id, donation_id, op
         FROM vector_sync_outbox
        WHERE processed_at IS NULL
        ORDER BY outbox_id
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [batch],
    );
    if (rows.length === 0) {
      await client.query("COMMIT");
      return { upserted, deleted };
    }
    await ensureCollection();

    for (const row of rows) {
      const d = row.op === "UPSERT" ? await loadDonation(client, row.donation_id) : undefined;
      if (d && LIVE.has(d.status)) {
        await upsertVector(row.donation_id, await embed(donationText(d)));
        upserted++;
      } else {
        // DELETE op, or an UPSERT for a listing that has since gone away
        await deleteVector(row.donation_id);
        deleted++;
      }
    }

    await client.query(
      "UPDATE vector_sync_outbox SET processed_at = clock_timestamp() WHERE outbox_id = ANY($1::bigint[])",
      [rows.map((r) => r.outbox_id)],
    );
    await client.query("COMMIT");
  } catch (err) {
    // Rows stay unprocessed and are retried on the next run; Postgres is still correct.
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { upserted, deleted };
}

/** Full rebuild: embed every live listing (used after recreating the collection). */
export async function backfillVectors(): Promise<number> {
  await ensureCollection();
  const { rows } = await webPool.query<DonationRow & { donation_id: string }>(
    `SELECT d.donation_id, d.description, d.dietary_tags, d.status::text AS status,
            (SELECT string_agg(f.name, ', ' ORDER BY f.name) FROM food_items f
              WHERE f.donation_id = d.donation_id) AS items
       FROM donations d
      WHERE d.status IN ('AVAILABLE', 'ALLOCATED')`,
  );
  for (const d of rows) await upsertVector(d.donation_id, await embed(donationText(d)));
  return rows.length;
}

/** Fire-and-forget nudge after a write, so new listings are searchable within a second. */
export function kickVectorSync() {
  processOutbox().catch((err) => console.warn("[vector-sync] deferred:", err?.message ?? err));
}
