import { adminPool, adminQuery } from "../db";

/*
 * Admin reports. Same SQL as db/reports.sql, run on the admin pool
 * (foodlink_dba), which may read the RLS-bypassing view and the
 * materialized view that the app role cannot.
 */

export type StatusCount = { status: string; n: string };
export const donationStatusCounts = () =>
  adminQuery<StatusCount>(
    `SELECT status::text AS status, count(*) AS n FROM donations GROUP BY status
      ORDER BY array_position(enum_range(NULL::donation_status), status)`,
  );

export type Housekeeping = { outbox_pending: string; sessions_active: string; stale_live: string };
export const housekeeping = async () =>
  (
    await adminQuery<Housekeeping>(
      `SELECT (SELECT count(*) FROM vector_sync_outbox WHERE processed_at IS NULL)                  AS outbox_pending,
              (SELECT count(*) FROM sessions WHERE expires_at > now())                              AS sessions_active,
              (SELECT count(*) FROM donations
                WHERE status IN ('DRAFT', 'AVAILABLE') AND expires_at <= now())                     AS stale_live`,
    )
  )[0];

// R1 donor leaderboard
export type LeaderRow = {
  impact_rank: string;
  donor_org: string;
  servings_delivered: string;
  share_pct: string | null;
  recipients_served: string;
  waste_pct: string | null;
};
export const donorLeaderboard = () =>
  adminQuery<LeaderRow>(
    `SELECT impact_rank, donor_org, servings_delivered,
            round(100.0 * servings_delivered / NULLIF(SUM(servings_delivered) OVER (), 0), 1) AS share_pct,
            recipients_served, waste_pct
       FROM mv_donor_impact
      ORDER BY impact_rank, donor_org`,
  );

// R2 daily activity, last 14 days, with running total
export type DayRow = { day: string; listings: string; claims: string; servings: string; running_servings: string };
export const dailyActivity = () =>
  adminQuery<DayRow>(
    `WITH days AS (
         SELECT d::date AS day FROM generate_series(current_date - 13, current_date, interval '1 day') AS d
     ),
     per_day AS (
         SELECT days.day,
                (SELECT count(*) FROM donations x WHERE x.created_at::date = days.day)   AS listings,
                (SELECT count(*) FROM allocations a WHERE a.created_at::date = days.day) AS claims,
                (SELECT coalesce(sum(a.quantity), 0)
                   FROM allocations a JOIN pickups p ON p.allocation_id = a.allocation_id
                  WHERE a.status = 'completed' AND p.picked_up_at::date = days.day)       AS servings
           FROM days
     )
     SELECT to_char(day, 'YYYY-MM-DD') AS day, listings, claims, servings,
            SUM(servings) OVER (ORDER BY day) AS running_servings
       FROM per_day ORDER BY day`,
  );

// R3 recipient reliability (CTE)
export type ReliabilityRow = { recipient_org: string; completed: string; missed: string; missed_pct: string | null; flagged: boolean | null };
export const recipientReliability = () =>
  adminQuery<ReliabilityRow>(
    `WITH outcomes AS (
         SELECT a.recipient_org_id,
                count(*) FILTER (WHERE p.status = 'completed') AS completed,
                count(*) FILTER (WHERE p.status = 'missed')    AS missed
           FROM allocations a JOIN pickups p ON p.allocation_id = a.allocation_id
          GROUP BY a.recipient_org_id
     )
     SELECT o.name AS recipient_org, completed, missed,
            round(100.0 * missed / NULLIF(completed + missed, 0), 1) AS missed_pct,
            (100.0 * missed / NULLIF(completed + missed, 0)) > 20    AS flagged
       FROM outcomes JOIN organizations o ON o.org_id = outcomes.recipient_org_id
      ORDER BY missed_pct DESC NULLS LAST, recipient_org`,
  );

// R4 waste by time of day posted
export type WasteRow = { posted: string; listings: string; expired: string; servings_wasted: string };
export const wasteByTimeOfDay = () =>
  adminQuery<WasteRow>(
    `SELECT (ARRAY['Morning (before 11)', 'Midday (11 to 16)', 'Evening (16 to 20)', 'Night (after 20)'])[bucket] AS posted,
            count(*)                                                     AS listings,
            count(*) FILTER (WHERE status = 'EXPIRED')                   AS expired,
            coalesce(sum(quantity) FILTER (WHERE status = 'EXPIRED'), 0) AS servings_wasted
       FROM (SELECT status, quantity,
                    CASE WHEN extract(hour FROM created_at) < 11 THEN 1
                         WHEN extract(hour FROM created_at) < 16 THEN 2
                         WHEN extract(hour FROM created_at) < 20 THEN 3
                         ELSE 4 END AS bucket
               FROM donations
              WHERE status <> 'DRAFT') t
      GROUP BY bucket
      ORDER BY bucket`,
  );

// R6 partial index plan
export async function activeListingPlan(): Promise<string[]> {
  const c = await adminPool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL enable_seqscan = off");
    const res = await c.query<{ "QUERY PLAN": string }>(
      `EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)
       SELECT donation_id, expires_at FROM donations
        WHERE status = 'AVAILABLE' AND expires_at > now() ORDER BY expires_at`,
    );
    await c.query("COMMIT");
    return res.rows.map((r) => r["QUERY PLAN"]);
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

// Recent audit events across the platform (trigger-written history)
export type AuditRow = {
  changed_at: Date;
  entity_type: string;
  description: string | null;
  old_status: string | null;
  new_status: string;
  changed_by: string | null;
  db_user: string;
};
export const recentAudit = () =>
  adminQuery<AuditRow>(
    `SELECT h.changed_at, h.entity_type, d.description, h.old_status, h.new_status, u.name AS changed_by, h.db_user
       FROM status_history h
       LEFT JOIN donations d ON d.donation_id = h.donation_id
       LEFT JOIN users u     ON u.user_id = h.changed_by
      WHERE h.changed_at >= now() - interval '2 days'
      ORDER BY h.changed_at DESC
      LIMIT 15`,
  );
