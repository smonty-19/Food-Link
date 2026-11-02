"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { adminQuery } from "@/lib/db";
import { friendlyDbError } from "@/lib/db-errors";
import type { FormState } from "@/lib/form-state";
import { backfillVectors, processOutbox } from "@/lib/vector-sync";

/* Platform maintenance. Admin only; every action re-checks the role. */

async function run(fn: () => Promise<string>): Promise<FormState> {
  await requireRole("admin");
  try {
    const success = await fn();
    revalidatePath("/admin");
    return { success };
  } catch (err) {
    const msg = (err as Error)?.message ?? "";
    if (/fetch failed|ECONNREFUSED/.test(msg)) return { error: "Qdrant is not reachable on QDRANT_URL." };
    return { error: friendlyDbError(err) };
  }
}

/** Expire listings whose deadline passed while nothing wrote to them. */
export async function runExpirySweep(_prev: FormState, _fd: FormData): Promise<FormState> {
  return run(async () => {
    const [r] = await adminQuery<{ n: number }>("SELECT expire_stale_donations() AS n");
    return `${r.n} listing${r.n === 1 ? "" : "s"} expired.`;
  });
}

/** REFRESH ... CONCURRENTLY keeps the leaderboard readable while it rebuilds. */
export async function refreshImpact(_prev: FormState, _fd: FormData): Promise<FormState> {
  return run(async () => {
    await adminQuery("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_donor_impact");
    return "Leaderboard refreshed.";
  });
}

export async function syncVectors(_prev: FormState, _fd: FormData): Promise<FormState> {
  return run(async () => {
    let up = 0;
    let del = 0;
    for (;;) {
      const r = await processOutbox(50);
      up += r.upserted;
      del += r.deleted;
      if (r.upserted + r.deleted === 0) break;
    }
    return `Outbox drained: ${up} embedded, ${del} removed.`;
  });
}

export async function rebuildVectors(_prev: FormState, _fd: FormData): Promise<FormState> {
  return run(async () => `Re-embedded ${await backfillVectors()} live listings.`);
}
