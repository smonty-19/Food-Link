/* ======================================================================
   FoodLink: reports.sql
   Showcase analytical queries (viva). The admin page runs the same SQL.
       psql -U postgres -d foodlink -f db/reports.sql
   ====================================================================== */

\pset null '(null)'
SET search_path TO public;

-- R1  Donor leaderboard (window functions over the materialized view)
--     RANK() orders donors by servings delivered; SUM() OVER () gives each
--     donor's share of the platform total without a second query.
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_donor_impact;
SELECT impact_rank,
       donor_org,
       servings_delivered,
       round(100.0 * servings_delivered / NULLIF(SUM(servings_delivered) OVER (), 0), 1) AS share_pct,
       recipients_served,
       waste_pct
  FROM mv_donor_impact
 ORDER BY impact_rank, donor_org;

-- R2  Daily activity for the last 14 days with a running total
--     generate_series fills days with no activity; SUM() OVER (ORDER BY day)
--     accumulates servings delivered.
WITH days AS (
    SELECT d::date AS day
      FROM generate_series(current_date - 13, current_date, interval '1 day') AS d
),
per_day AS (
    SELECT days.day,
           (SELECT count(*) FROM donations x WHERE x.created_at::date = days.day)              AS listings,
           (SELECT count(*) FROM allocations a WHERE a.created_at::date = days.day)            AS claims,
           (SELECT coalesce(sum(a.quantity), 0)
              FROM allocations a JOIN pickups p ON p.allocation_id = a.allocation_id
             WHERE a.status = 'completed' AND p.picked_up_at::date = days.day)                  AS servings
      FROM days
)
SELECT day, listings, claims, servings,
       SUM(servings) OVER (ORDER BY day) AS running_servings
  FROM per_day
 ORDER BY day;

-- R3  Recipient reliability (CTE): share of pickups each recipient missed.
--     Organizations above 20 % are flagged for follow-up.
WITH outcomes AS (
    SELECT a.recipient_org_id,
           count(*) FILTER (WHERE p.status = 'completed') AS completed,
           count(*) FILTER (WHERE p.status = 'missed')    AS missed
      FROM allocations a
      JOIN pickups p ON p.allocation_id = a.allocation_id
     GROUP BY a.recipient_org_id
)
SELECT o.name AS recipient_org,
       completed,
       missed,
       round(100.0 * missed / NULLIF(completed + missed, 0), 1)       AS missed_pct,
       (100.0 * missed / NULLIF(completed + missed, 0)) > 20          AS flagged
  FROM outcomes
  JOIN organizations o ON o.org_id = outcomes.recipient_org_id
 ORDER BY missed_pct DESC NULLS LAST, recipient_org;

-- R4  Waste analysis: servings that expired unclaimed, by the time of day
--     the listing was posted (late listings are harder to place).
SELECT CASE
         WHEN extract(hour FROM created_at) < 11 THEN '1 morning (before 11)'
         WHEN extract(hour FROM created_at) < 16 THEN '2 midday (11 to 16)'
         WHEN extract(hour FROM created_at) < 20 THEN '3 evening (16 to 20)'
         ELSE '4 night (after 20)'
       END                                                         AS posted,
       count(*)                                                    AS listings,
       count(*) FILTER (WHERE status = 'EXPIRED')                  AS expired,
       coalesce(sum(quantity) FILTER (WHERE status = 'EXPIRED'), 0) AS servings_wasted
  FROM donations
 WHERE status <> 'DRAFT'
 GROUP BY 1
 ORDER BY 1;

-- R5  Matching coverage: for each active requirement, how many open listings
--     satisfy its diet (array containment @>) and capacity right now.
SELECT o.name AS recipient_org,
       r.description,
       r.dietary_constraints,
       count(d.donation_id) AS compatible_listings
  FROM requirements r
  JOIN organizations o ON o.org_id = r.org_id
  LEFT JOIN donations d
         ON d.status = 'AVAILABLE' AND d.expires_at > now()
        AND d.dietary_tags @> r.dietary_constraints
        AND d.quantity <= r.max_capacity
        AND d.org_id <> r.org_id
 WHERE r.active
 GROUP BY o.name, r.requirement_id, r.description, r.dietary_constraints
 ORDER BY compatible_listings, recipient_org;

-- R6  The partial index in action. idx_donations_available_expiry only
--     indexes AVAILABLE rows, so the hot "what's open" query stays small.
--     Seed data is tiny, so sequential scans are disabled for this one
--     transaction to show which index the planner would use.
BEGIN;
SET LOCAL enable_seqscan = off;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT donation_id, expires_at
  FROM donations
 WHERE status = 'AVAILABLE' AND expires_at > now()
 ORDER BY expires_at;
COMMIT;
