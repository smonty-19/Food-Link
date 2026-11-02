/*
 * Background jobs, started once when the Node.js server boots.
 *
 * Expiry has three layers (be ready to explain this in the viva):
 *   1. trigger A.T1 expires a row on ANY write after its deadline
 *   2. this job sweeps rows nobody touches (expire_stale_donations, every 60 s)
 *   3. every read and allocation also checks expires_at > now()
 * Layer 3 alone guarantees correctness; 1 and 2 keep the stored status honest.
 *
 * The outbox job pushes queued donation changes to Qdrant every 15 s.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const g = globalThis as unknown as { __foodlinkJobs?: boolean };
  if (g.__foodlinkJobs) return; // dev hot-reload must not start a second set
  g.__foodlinkJobs = true;

  const { webPool } = await import("./lib/db");
  const { processOutbox } = await import("./lib/vector-sync");

  setInterval(async () => {
    try {
      const { rows } = await webPool.query<{ n: number }>("SELECT expire_stale_donations() AS n");
      if (rows[0].n > 0) console.log(`[expiry] ${rows[0].n} listing(s) expired`);
    } catch (err) {
      console.warn("[expiry] sweep failed:", (err as Error).message);
    }
  }, 60_000);

  setInterval(() => {
    processOutbox().catch((err) => console.warn("[vector-sync] deferred:", (err as Error).message));
  }, 15_000);
}
