/*
 * CLI backup for the concurrency demo (same code path as /admin/demo).
 *   npm run race            -> SAFE then UNSAFE with 10 claimers
 *   npm run race -- 6 safe  -> 6 claimers, SAFE only
 */
import "dotenv/config";
import { runRace, type RaceMode } from "../src/lib/race";
import { adminPool, webPool } from "../src/lib/db";

async function main() {
  const n = Math.min(12, Math.max(2, Number(process.argv[2]) || 10));
  const modes: RaceMode[] = process.argv[3] === "safe" || process.argv[3] === "unsafe" ? [process.argv[3]] : ["safe", "unsafe"];

  for (const mode of modes) {
    const r = await runRace(mode, n);
    console.log(`\n=== ${mode.toUpperCase()}: ${n} organizations claim donation ${r.donationId} at once ===`);
    console.table(r.outcomes.map(({ claimer, org, outcome, ms }) => ({ claimer, org, outcome, ms })));
    console.log(
      `winners: ${r.outcomes.filter((o) => o.ok).length}   active allocations: ${r.activeAllocations}   ` +
        `donation status: ${r.finalStatus}   ${r.correct ? "PASS: never over-allocated" : "FAIL: over-allocated"}`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => Promise.all([webPool.end(), adminPool.end()]));
