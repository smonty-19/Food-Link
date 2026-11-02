import type { PoolClient } from "pg";

/* Queries used by both donor and recipient pages. */

export type HistoryEntry = {
  entity_type: "donation" | "allocation";
  old_status: string | null;
  new_status: string;
  changed_at: Date;
  changed_by_name: string | null;
  db_user: string;
};

/**
 * Lifecycle timeline of a donation and its allocations, written ONLY by the
 * history triggers (A.T2, B.T5). The app role cannot SELECT status_history,
 * so this goes through donation_timeline(), a SECURITY DEFINER function that
 * only answers the donor or a recipient of the donation (db/app_support.sql).
 * NULL changed_by means the system (e.g. the expiry sweep) made the change.
 */
export async function donationHistory(c: PoolClient, donationId: string) {
  const { rows } = await c.query<HistoryEntry>("SELECT * FROM donation_timeline($1)", [donationId]);
  return rows;
}
