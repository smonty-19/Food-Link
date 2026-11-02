import { query } from "./db";
import { embed } from "./embed";
import { nearestDonationIds } from "./qdrant";

/*
 * Two-stage matching. The order is fixed:
 *   1. Qdrant: semantic recall -> top-K donation IDs (meaning, not keywords)
 *   2. PostgreSQL: hard constraints on those IDs (available, unexpired, diet,
 *      capacity, not own org, within radius), keeping Qdrant's rank order
 * Qdrant is never trusted for availability. If Qdrant is down, we fall back
 * to a pure PostgreSQL match (p_candidate_ids = NULL) and say so in the UI.
 */

export type Match = {
  donation_id: string;
  description: string;
  donor_org: string;
  servings: string;
  dietary_tags: string[];
  items: string | null;
  distance_km: string;
  hours_to_expiry: string;
  pickup_lat: number;
  pickup_lng: number;
};

export type MatchResult = { matches: Match[]; semantic: boolean };

const FIRST_K = 50;
const RETRY_K = 200;
const SHOW = 10;

async function recall(text: string, k: number): Promise<string[] | null> {
  try {
    return await nearestDonationIds(await embed(text), k);
  } catch (err) {
    console.warn("[matching] Qdrant unavailable, using PostgreSQL only:", (err as Error)?.message);
    return null;
  }
}

// ---------- for a requirement (uses find_matching_donations from review2.sql) ----------

async function validateForRequirement(requirementId: string, radiusKm: number, ids: string[] | null) {
  return query<Match>(
    `SELECT m.donation_id, m.description, m.donor_org, m.servings, m.dietary_tags,
            m.distance_km, m.hours_to_expiry, d.pickup_lat, d.pickup_lng,
            (SELECT string_agg(f.name || ' (' || f.quantity || ' ' || f.unit || ')', ', ' ORDER BY f.name)
               FROM food_items f WHERE f.donation_id = m.donation_id) AS items
       FROM find_matching_donations($1, $2, $3::uuid[]) WITH ORDINALITY AS m
       JOIN donations d ON d.donation_id = m.donation_id
      ORDER BY m.ordinality`,
    [requirementId, radiusKm, ids],
  );
}

export async function matchesForRequirement(
  requirement: { requirement_id: string; description: string; dietary_constraints: string[] },
  radiusKm: number,
): Promise<MatchResult> {
  const text = [requirement.description, ...requirement.dietary_constraints].join(". ");

  let ids = await recall(text, FIRST_K);
  if (ids === null) {
    return { matches: (await validateForRequirement(requirement.requirement_id, radiusKm, null)).slice(0, SHOW), semantic: false };
  }
  let rows = await validateForRequirement(requirement.requirement_id, radiusKm, ids);
  if (rows.length < 5 && ids.length === FIRST_K) {
    ids = (await recall(text, RETRY_K)) ?? ids;
    rows = await validateForRequirement(requirement.requirement_id, radiusKm, ids);
  }
  return { matches: rows.slice(0, SHOW), semantic: true };
}

// ---------- free-text browse (uses browse_available_donations from app_support.sql) ----------

export async function browseDonations(opts: {
  lat: number;
  lng: number;
  radiusKm: number;
  excludeOrg: string;
  q?: string;
}): Promise<MatchResult> {
  const q = opts.q?.trim();
  const ids = q ? await recall(q, FIRST_K) : null;
  const rows = await query<Match>(
    `SELECT donation_id, description, donor_org, servings, dietary_tags, items,
            pickup_lat, pickup_lng, distance_km, hours_to_expiry
       FROM browse_available_donations($1, $2, $3, $4::uuid[], $5)`,
    [opts.lat, opts.lng, opts.radiusKm, ids, opts.excludeOrg],
  );
  return { matches: q ? rows.slice(0, SHOW) : rows, semantic: !q || ids !== null };
}
