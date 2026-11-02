"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { PoolClient } from "pg";
import { actorOf, requireRole } from "@/lib/auth";
import { withActor } from "@/lib/db";
import { friendlyDbError } from "@/lib/db-errors";
import { DIETARY_TAGS } from "@/lib/format";
import { UUID_RE, type FormState } from "@/lib/form-state";

/*
 * Recipient Server Actions. Inserts and updates on requirements/allocations/
 * pickups are additionally guarded by the RLS policies from review2.sql
 * Section 11: even if a check here were missed, Postgres would refuse a
 * write for another organization.
 */

// ---------- requirements ----------

const RequirementSchema = z.object({
  description: z.string().trim().min(5, "Describe what you need in a few words.").max(500),
  maxCapacity: z.coerce.number().int("Capacity is a whole number of servings.").positive("Capacity must be positive.").max(10000),
  constraints: z.array(z.enum(DIETARY_TAGS)),
});

export async function createRequirement(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole("recipient");
  const parsed = RequirementSchema.safeParse({
    ...Object.fromEntries(formData),
    constraints: formData.getAll("constraints"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  let id: string;
  try {
    id = await withActor(actorOf(user), async (c) => {
      // RLS policy req_app_insert: WITH CHECK (org_id = current_org_id())
      const res = await c.query<{ requirement_id: string }>(
        `INSERT INTO requirements (org_id, created_by, description, dietary_constraints, max_capacity)
         VALUES ($1, $2, $3, $4::text[], $5) RETURNING requirement_id`,
        [user.orgId, user.userId, d.description, d.constraints, d.maxCapacity],
      );
      return res.rows[0].requirement_id;
    });
  } catch (err) {
    return { error: friendlyDbError(err) };
  }
  revalidatePath("/recipient");
  redirect(`/recipient/requirements/${id}`);
}

export async function toggleRequirement(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole("recipient");
  const id = String(formData.get("requirementId") ?? "");
  if (!UUID_RE.test(id)) return { error: "Invalid request." };
  try {
    const changed = await withActor(actorOf(user), async (c) => {
      // RLS policy req_app_update limits this to the caller's own rows
      const res = await c.query<{ active: boolean }>(
        "UPDATE requirements SET active = NOT active WHERE requirement_id = $1 RETURNING active",
        [id],
      );
      return res.rows[0];
    });
    if (!changed) return { error: "Not found, or it doesn't belong to your organization." };
    revalidatePath("/recipient");
    revalidatePath(`/recipient/requirements/${id}`);
    return { success: changed.active ? "Requirement is active again." : "Requirement paused." };
  } catch (err) {
    return { error: friendlyDbError(err) };
  }
}

// ---------- claiming: the concurrency-critical path ----------

export async function claimDonation(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole("recipient");
  const donationId = String(formData.get("donationId") ?? "");
  const requirementId = String(formData.get("requirementId") ?? "");
  if (!UUID_RE.test(donationId) || !UUID_RE.test(requirementId)) return { error: "Choose one of your requirements." };

  // For the two-browser demo, DEMO_CLAIM_DELAY_MS=3000 holds the row lock for 3 s
  const delay = Math.max(0, Number(process.env.DEMO_CLAIM_DELAY_MS ?? 0) || 0);

  try {
    await withActor(actorOf(user), (c) =>
      // allocate_donation locks the donation row (SELECT ... FOR UPDATE); a second
      // claimer waits here, then sees ALLOCATED and gets a clean error. The app
      // never does read-check-write itself.
      delay > 0
        ? c.query("SELECT allocate_donation_slow($1, $2, $3, $4)", [donationId, requirementId, user.userId, delay])
        : c.query("SELECT allocate_donation($1, $2, $3)", [donationId, requirementId, user.userId]),
    );
  } catch (err) {
    return { error: friendlyDbError(err) };
  }
  revalidatePath("/recipient");
  revalidatePath("/recipient/browse");
  return { success: "It's yours. Schedule a pickup from your overview page." };
}

// ---------- pickups and allocations ----------

/** The allocation must have been made TO the caller's organization. */
async function assertOwnAllocation(c: PoolClient, allocationId: string, orgId: string) {
  const { rowCount } = await c.query("SELECT 1 FROM allocations WHERE allocation_id = $1 AND recipient_org_id = $2", [allocationId, orgId]);
  if (!rowCount) throw Object.assign(new Error("not found"), { code: "P0001" });
}

async function allocationAction(
  formData: FormData,
  run: (c: PoolClient, allocationId: string) => Promise<unknown>,
  success: string,
): Promise<FormState> {
  const user = await requireRole("recipient");
  const allocationId = String(formData.get("allocationId") ?? "");
  if (!UUID_RE.test(allocationId)) return { error: "Invalid request." };
  try {
    await withActor(actorOf(user), async (c) => {
      await assertOwnAllocation(c, allocationId, user.orgId);
      await run(c, allocationId);
    });
  } catch (err) {
    return { error: friendlyDbError(err) };
  }
  revalidatePath("/recipient");
  return { success };
}

const ScheduleSchema = z.object({
  // <input type="datetime-local"> gives local India time without an offset
  when: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick a date and time.")
    .transform((s) => new Date(`${s}:00+05:30`))
    .refine((d) => d.getTime() > Date.now() - 60_000, "Pick a time in the future."),
});

export async function schedulePickup(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = ScheduleSchema.safeParse({ when: formData.get("when") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  return allocationAction(formData, (c, id) => c.query("CALL schedule_pickup($1, $2)", [id, parsed.data.when]), "Pickup scheduled.");
}

/** Recipient confirms the food arrived: allocation completed, donation COMPLETED (trigger B.T4). */
export async function confirmReceipt(_prev: FormState, formData: FormData): Promise<FormState> {
  return allocationAction(formData, (c, id) => c.query("CALL confirm_receipt($1)", [id]), "Thank you. Marked as received.");
}

/** Give the food back: allocation cancelled, donation AVAILABLE again, pickup closed (trigger B.T4). */
export async function cancelAllocation(_prev: FormState, formData: FormData): Promise<FormState> {
  return allocationAction(formData, (c, id) => c.query("CALL cancel_allocation($1)", [id]), "Released. Others can claim it now.");
}
