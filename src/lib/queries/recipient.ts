import type { PoolClient } from "pg";

/*
 * Recipient-side reads. Run inside withActor(): requirements are readable by
 * everyone (needed for matching) but allocations and pickups are row-level
 * secured, so these queries only ever see the caller's own allocations.
 */

export type RequirementRow = {
  requirement_id: string;
  description: string;
  dietary_constraints: string[];
  max_capacity: string;
  active: boolean;
  created_at: Date;
  in_progress: string;
  completed: string;
  servings_received: string;
};

export async function recipientRequirements(c: PoolClient, orgId: string) {
  const { rows } = await c.query<RequirementRow>(
    `SELECT r.requirement_id, r.description, r.dietary_constraints, r.max_capacity, r.active, r.created_at,
            count(a.allocation_id) FILTER (WHERE a.status = 'confirmed')            AS in_progress,
            count(a.allocation_id) FILTER (WHERE a.status = 'completed')            AS completed,
            coalesce(sum(a.quantity) FILTER (WHERE a.status = 'completed'), 0)       AS servings_received
       FROM requirements r
       LEFT JOIN allocations a ON a.requirement_id = r.requirement_id
      WHERE r.org_id = $1
      GROUP BY r.requirement_id
      ORDER BY r.active DESC, r.created_at DESC`,
    [orgId],
  );
  return rows;
}

export async function requirementById(c: PoolClient, requirementId: string, orgId: string) {
  const { rows } = await c.query<Omit<RequirementRow, "in_progress" | "completed" | "servings_received">>(
    `SELECT requirement_id, description, dietary_constraints, max_capacity, active, created_at
       FROM requirements
      WHERE requirement_id = $1 AND org_id = $2`,
    [requirementId, orgId],
  );
  return rows[0];
}

export type RecipientAllocation = {
  allocation_id: string;
  donation_id: string;
  status: string;
  created_at: Date;
  servings: string;
  description: string;
  dietary_tags: string[];
  donor_org: string;
  donor_address: string | null;
  pickup_lat: number;
  pickup_lng: number;
  expires_at: Date;
  requirement: string;
  pickup_status: string | null;
  scheduled_at: Date | null;
  picked_up_at: Date | null;
};

export async function recipientAllocations(c: PoolClient, orgId: string) {
  const { rows } = await c.query<RecipientAllocation>(
    `SELECT a.allocation_id, a.donation_id, a.status, a.created_at, a.quantity AS servings,
            d.description, d.dietary_tags, d.pickup_lat, d.pickup_lng, d.expires_at,
            o.name AS donor_org, o.address AS donor_address,
            r.description AS requirement,
            p.status AS pickup_status, p.scheduled_at, p.picked_up_at
       FROM allocations a
       JOIN donations d     ON d.donation_id = a.donation_id
       JOIN organizations o ON o.org_id = d.org_id
       JOIN requirements r  ON r.requirement_id = a.requirement_id
       LEFT JOIN pickups p  ON p.allocation_id = a.allocation_id
      WHERE a.recipient_org_id = $1
      ORDER BY CASE a.status WHEN 'confirmed' THEN 0 ELSE 1 END, a.created_at DESC`,
    [orgId],
  );
  return rows;
}

export type RecipientStats = {
  active_requirements: string;
  open_allocations: string;
  servings_received: string;
  fulfilment_pct: string | null;
};

export async function recipientStats(c: PoolClient, orgId: string) {
  const { rows } = await c.query<RecipientStats>(
    `SELECT (SELECT count(*) FROM requirements WHERE org_id = $1 AND active)                       AS active_requirements,
            (SELECT count(*) FROM allocations  WHERE recipient_org_id = $1 AND status = 'confirmed') AS open_allocations,
            (SELECT coalesce(sum(quantity), 0) FROM allocations
              WHERE recipient_org_id = $1 AND status = 'completed')                                 AS servings_received,
            recipient_fulfilment_rate($1)                                                           AS fulfilment_pct`,
    [orgId],
  );
  return rows[0];
}

/** Active requirements of this org, for the "claim for which requirement?" picker. */
export async function activeRequirementOptions(c: PoolClient, orgId: string) {
  const { rows } = await c.query<{ requirement_id: string; description: string; dietary_constraints: string[]; max_capacity: string }>(
    `SELECT requirement_id, description, dietary_constraints, max_capacity
       FROM requirements WHERE org_id = $1 AND active ORDER BY created_at DESC`,
    [orgId],
  );
  return rows;
}
