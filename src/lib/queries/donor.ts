import type { PoolClient } from "pg";

/*
 * Donor-side reads. Run inside withActor(): allocations and pickups are
 * protected by row-level security, so a donor only ever sees the allocations
 * made against its own listings.
 */

export type DonorListing = {
  donation_id: string;
  description: string;
  servings: string;
  status: string;
  expires_at: Date;
  created_at: Date;
  recipient_org: string | null;
  pickup_status: string | null;
};

export async function donorListings(c: PoolClient, orgId: string) {
  const { rows } = await c.query<DonorListing>(
    `SELECT d.donation_id, d.description, d.quantity AS servings, d.status, d.expires_at, d.created_at,
            r.name AS recipient_org, p.status AS pickup_status
       FROM donations d
       LEFT JOIN allocations a   ON a.donation_id = d.donation_id AND a.status <> 'cancelled'
       LEFT JOIN organizations r ON r.org_id = a.recipient_org_id
       LEFT JOIN pickups p       ON p.allocation_id = a.allocation_id
      WHERE d.org_id = $1
      ORDER BY CASE WHEN d.status IN ('DRAFT', 'AVAILABLE', 'ALLOCATED', 'PICKED_UP') THEN 0 ELSE 1 END,
               d.created_at DESC`,
    [orgId],
  );
  return rows;
}

export type DonorStats = {
  live: string;
  completed: string;
  servings_delivered: string;
  recipients_served: string;
  waste_pct: string | null;
};

export async function donorStats(c: PoolClient, orgId: string) {
  const { rows } = await c.query<DonorStats>(
    `SELECT count(*) FILTER (WHERE d.status IN ('AVAILABLE', 'ALLOCATED', 'PICKED_UP'))   AS live,
            count(*) FILTER (WHERE d.status = 'COMPLETED')                                 AS completed,
            coalesce(sum(d.quantity) FILTER (WHERE d.status = 'COMPLETED'), 0)             AS servings_delivered,
            (SELECT count(DISTINCT a.recipient_org_id)
               FROM allocations a JOIN donations x ON x.donation_id = a.donation_id
              WHERE x.org_id = $1 AND a.status = 'completed')                              AS recipients_served,
            donor_waste_rate($1)                                                            AS waste_pct
       FROM donations d
      WHERE d.org_id = $1`,
    [orgId],
  );
  return rows[0];
}

export type DonationDetail = {
  donation_id: string;
  org_id: string;
  description: string;
  dietary_tags: string[];
  servings: string;
  status: string;
  prepared_at: Date;
  expires_at: Date;
  created_at: Date;
  pickup_lat: number;
  pickup_lng: number;
  created_by_name: string | null;
};

export async function donationDetail(c: PoolClient, donationId: string) {
  const { rows } = await c.query<DonationDetail>(
    `SELECT d.donation_id, d.org_id, d.description, d.dietary_tags, d.quantity AS servings, d.status,
            d.prepared_at, d.expires_at, d.created_at, d.pickup_lat, d.pickup_lng, u.name AS created_by_name
       FROM donations d
       LEFT JOIN users u ON u.user_id = d.created_by
      WHERE d.donation_id = $1`,
    [donationId],
  );
  return rows[0];
}

export async function donationItems(c: PoolClient, donationId: string) {
  const { rows } = await c.query<{ name: string; quantity: string; unit: string }>(
    "SELECT name, quantity, unit FROM food_items WHERE donation_id = $1 ORDER BY name",
    [donationId],
  );
  return rows;
}

export type AllocationForDonation = {
  allocation_id: string;
  status: string;
  created_at: Date;
  recipient_org: string;
  recipient_address: string | null;
  requirement: string;
  allocated_by_name: string | null;
  pickup_status: string | null;
  scheduled_at: Date | null;
  picked_up_at: Date | null;
};

/** Every allocation of this donation, newest first (RLS-filtered). */
export async function donationAllocations(c: PoolClient, donationId: string) {
  const { rows } = await c.query<AllocationForDonation>(
    `SELECT a.allocation_id, a.status, a.created_at,
            o.name AS recipient_org, o.address AS recipient_address,
            r.description AS requirement, u.name AS allocated_by_name,
            p.status AS pickup_status, p.scheduled_at, p.picked_up_at
       FROM allocations a
       JOIN organizations o ON o.org_id = a.recipient_org_id
       JOIN requirements r  ON r.requirement_id = a.requirement_id
       LEFT JOIN users u    ON u.user_id = a.allocated_by
       LEFT JOIN pickups p  ON p.allocation_id = a.allocation_id
      WHERE a.donation_id = $1
      ORDER BY a.created_at DESC`,
    [donationId],
  );
  return rows;
}
