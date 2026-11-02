import type { PoolClient } from "pg";
import { adminQuery, webPool } from "./db";

/*
 * The concurrency demo (used by /admin/demo and scripts/race-test.ts).
 *
 *  1. Create a fresh AVAILABLE donation (demo_create_race_donation).
 *  2. Pick N claimers: real recipient users whose requirements fit it.
 *  3. Give each claimer its OWN connection on the least-privilege web role,
 *     with its own organization set for row-level security, and line them all
 *     up at a barrier so they fire at the same instant.
 *  4. SAFE   -> allocate_donation_slow: SELECT ... FOR UPDATE queues claimers
 *               on the row lock; one wins, the rest get a clean "not available".
 *     UNSAFE -> allocate_donation_unsafe: no lock, so every claimer passes the
 *               app-style status check. The database still refuses: trigger B.T1
 *               re-checks status at INSERT, and for INSERTs that truly overlap the
 *               partial unique index idx_allocations_one_active rejects them (23505).
 *  5. Count active allocations for the donation: it must never exceed one.
 */

export type RaceMode = "safe" | "unsafe";

export type ClaimOutcome = {
  claimer: number;
  org: string;
  ok: boolean;
  outcome: string;
  code: string | null;
  ms: number;
};

export type RaceResult = {
  mode: RaceMode;
  donationId: string;
  outcomes: ClaimOutcome[];
  activeAllocations: number;
  finalStatus: string;
  correct: boolean;
};

const SAFE_HOLD_MS = 150; // lock hold time per claimer, so the queue is visible
const UNSAFE_GAP_MS = 300; // gap between the unlocked read and the write

function describe(err: { code?: string; message?: string; constraint?: string }, mode: RaceMode) {
  if (err.code === "23505") return `caught by unique index ${err.constraint ?? ""}`.trim();
  if (/Unsafe pre-check/.test(err.message ?? "")) return "rejected by unlocked pre-check";
  if (/not available/.test(err.message ?? ""))
    return mode === "safe" ? "waited for the lock, then saw ALLOCATED" : "caught by trigger B.T1 status re-check";
  if (err.code === "40P01") return "deadlock detected";
  return err.message ?? "error";
}

export async function runRace(mode: RaceMode, n: number): Promise<RaceResult> {
  const [{ id: donationId }] = await adminQuery<{ id: string }>("SELECT demo_create_race_donation(20) AS id");
  const pool = await adminQuery<{ requirement_id: string; user_id: string; org_id: string; org_name: string }>(
    "SELECT * FROM demo_race_claimants($1)",
    [donationId],
  );
  if (pool.length === 0) throw new Error("No eligible recipient requirements. Run db/review2.sql first.");
  const claimers = Array.from({ length: n }, (_, i) => pool[i % pool.length]);

  // Barrier: resolve once every claimer holds a connection inside its transaction
  let ready = 0;
  let release!: () => void;
  const go = new Promise<void>((r) => (release = r));

  const sql =
    mode === "safe"
      ? "SELECT allocate_donation_slow($1, $2, $3, $4) AS id"
      : "SELECT allocate_donation_unsafe($1, $2, $3, $4) AS id";
  const delay = mode === "safe" ? SAFE_HOLD_MS : UNSAFE_GAP_MS;

  const outcomes = await Promise.all(
    claimers.map(async (cl, i): Promise<ClaimOutcome> => {
      let client: PoolClient | undefined;
      try {
        client = await webPool.connect();
        await client.query("BEGIN");
        await client.query(
          "SELECT set_config('app.current_user_id', $1, true), set_config('app.current_org_id', $2, true)",
          [cl.user_id, cl.org_id],
        );
        if (++ready === claimers.length) release();
        await go;

        const t0 = performance.now();
        try {
          await client.query(sql, [donationId, cl.requirement_id, cl.user_id, delay]);
          await client.query("COMMIT");
          return { claimer: i + 1, org: cl.org_name, ok: true, outcome: "allocated", code: null, ms: Math.round(performance.now() - t0) };
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          const e = err as { code?: string; message?: string; constraint?: string };
          return { claimer: i + 1, org: cl.org_name, ok: false, outcome: describe(e, mode), code: e.code ?? null, ms: Math.round(performance.now() - t0) };
        }
      } catch (err) {
        if (++ready === claimers.length) release(); // never leave the others waiting
        return { claimer: i + 1, org: cl.org_name, ok: false, outcome: (err as Error).message, code: null, ms: 0 };
      } finally {
        client?.release();
      }
    }),
  );

  const [after] = await adminQuery<{ active: string; status: string }>(
    `SELECT (SELECT count(*) FROM allocations WHERE donation_id = $1 AND status <> 'cancelled') AS active,
            (SELECT status::text FROM donations WHERE donation_id = $1)                       AS status`,
    [donationId],
  );
  const activeAllocations = Number(after.active);

  return {
    mode,
    donationId,
    outcomes: outcomes.sort((a, b) => a.ms - b.ms),
    activeAllocations,
    finalStatus: after.status,
    correct: activeAllocations <= 1 && outcomes.filter((o) => o.ok).length <= 1,
  };
}
