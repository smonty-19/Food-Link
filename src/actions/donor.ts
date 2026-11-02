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
import { kickVectorSync } from "@/lib/vector-sync";

/*
 * Donor Server Actions. Each one re-checks the session and role (Server
 * Actions are public HTTP endpoints) and then calls the stored procedures
 * from review2.sql. Lifecycle rules live in the database triggers, so the
 * app never sets a donation status other than through these procedures.
 */

const ItemSchema = z.object({
  name: z.string().trim().min(1, "Every item needs a name.").max(255),
  quantity: z.coerce.number().positive("Item quantities must be positive."),
  unit: z.string().trim().min(1, "Every item needs a unit.").max(50),
});

const CreateSchema = z.object({
  description: z.string().trim().min(5, "Describe the food in a few words.").max(500),
  servings: z.coerce.number().positive("Servings must be positive.").max(5000),
  validHours: z.coerce.number().min(0.5, "Give it at least 30 minutes.").max(24 * 7),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  tags: z.array(z.enum(DIETARY_TAGS)),
  items: z.array(ItemSchema).min(1, "Add at least one food item."),
  intent: z.enum(["draft", "publish"]),
});

export async function createDonation(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole("donor");

  let items: unknown;
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { error: "Food items could not be read." };
  }
  const parsed = CreateSchema.safeParse({
    ...Object.fromEntries(formData),
    tags: formData.getAll("tags"),
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  let donationId: string;
  try {
    donationId = await withActor(actorOf(user), async (c) => {
      // Procedure from review2.sql: inserts the DRAFT donation and its items atomically
      const res = await c.query<{ p_donation_id: string }>(
        `CALL create_donation($1, $2, $3, $4::text[], $5, $6 * interval '1 hour', $7::jsonb, NULL)`,
        [user.orgId, user.userId, d.description, d.tags, d.servings, d.validHours, JSON.stringify(d.items)],
      );
      const id = res.rows[0].p_donation_id;

      // The procedure defaults the pickup point to the org address; use the pin instead
      await c.query("UPDATE donations SET pickup_lat = $2, pickup_lng = $3 WHERE donation_id = $1", [id, d.lat, d.lng]);

      if (d.intent === "publish") await c.query("CALL publish_donation($1)", [id]);
      return id;
    });
  } catch (err) {
    return { error: friendlyDbError(err) };
  }

  kickVectorSync(); // publish queued an UPSERT in vector_sync_outbox
  revalidatePath("/donor");
  redirect(`/donor/donations/${donationId}`);
}

// ---------- single-listing actions ----------

/** The donation must belong to the caller's organization. */
async function assertOwnDonation(c: PoolClient, donationId: string, orgId: string) {
  const { rowCount } = await c.query("SELECT 1 FROM donations WHERE donation_id = $1 AND org_id = $2", [donationId, orgId]);
  if (!rowCount) throw Object.assign(new Error("not found"), { code: "P0001" });
}

async function donorAction(
  formData: FormData,
  run: (c: PoolClient, ids: { donationId: string; allocationId?: string }, orgId: string) => Promise<void>,
  success: string,
): Promise<FormState> {
  const user = await requireRole("donor");
  const donationId = String(formData.get("donationId") ?? "");
  const allocationId = formData.get("allocationId") ? String(formData.get("allocationId")) : undefined;
  if (!UUID_RE.test(donationId) || (allocationId && !UUID_RE.test(allocationId))) return { error: "Invalid request." };

  try {
    await withActor(actorOf(user), async (c) => {
      await assertOwnDonation(c, donationId, user.orgId);
      await run(c, { donationId, allocationId }, user.orgId);
    });
  } catch (err) {
    return { error: friendlyDbError(err) };
  }
  kickVectorSync();
  revalidatePath(`/donor/donations/${donationId}`);
  revalidatePath("/donor");
  return { success };
}

export async function publishDonation(_prev: FormState, formData: FormData) {
  return donorAction(formData, (c, { donationId }) => c.query("CALL publish_donation($1)", [donationId]).then(() => {}), "Published. Recipients can now find it.");
}

export async function cancelDonation(_prev: FormState, formData: FormData) {
  return donorAction(formData, (c, { donationId }) => c.query("CALL cancel_donation($1)", [donationId]).then(() => {}), "Listing withdrawn.");
}

/** Donor hands the food over: pickup completed, donation becomes PICKED_UP (trigger B.T7). */
export async function completePickup(_prev: FormState, formData: FormData) {
  return donorAction(
    formData,
    (c, { allocationId }) => c.query("CALL complete_pickup($1)", [allocationId]).then(() => {}),
    "Marked as handed over.",
  );
}

/** Nobody came: allocation is cancelled and the food is released again (triggers B.T7, B.T4). */
export async function markPickupMissed(_prev: FormState, formData: FormData) {
  return donorAction(
    formData,
    (c, { allocationId }) => c.query("CALL mark_pickup_missed($1)", [allocationId]).then(() => {}),
    "Pickup marked as missed. The listing is available again.",
  );
}
