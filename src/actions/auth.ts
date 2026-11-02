"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { query, webPool } from "@/lib/db";
import { friendlyDbError } from "@/lib/db-errors";
import {
  endSession,
  hashPassword,
  homeFor,
  startSession,
  verifyPassword,
  type Role,
} from "@/lib/auth";

export type FormState = { error?: string } | undefined;

// ---------- login ----------

const LoginSchema = z.object({
  email: z.string().trim().email("Enter a valid email."),
  password: z.string().min(1, "Enter your password."),
});

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = LoginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { email, password } = parsed.data;

  // lower(email) uses the expression index idx_users_email_lower
  const rows = await query<{ user_id: string; password_hash: string; role: Role; is_active: boolean }>(
    "SELECT user_id, password_hash, role, is_active FROM users WHERE lower(email) = lower($1)",
    [email],
  );
  const user = rows[0];
  const check = user ? await verifyPassword(password, user.password_hash) : { ok: false, needsUpgrade: false };
  if (!user || !check.ok) return { error: "Email or password is incorrect." };
  if (!user.is_active) return { error: "This account has been deactivated." };

  if (check.needsUpgrade) {
    // Seed accounts: replace the legacy SHA-256 hash with bcrypt on first login
    await query("UPDATE users SET password_hash = $1 WHERE user_id = $2", [
      await hashPassword(password),
      user.user_id,
    ]);
  }

  await startSession(user.user_id);
  redirect(homeFor(user.role));
}

// ---------- logout ----------

export async function logout() {
  await endSession();
  redirect("/");
}

// ---------- register: organization + first user, one transaction ----------

const RegisterSchema = z.object({
  orgName: z.string().trim().min(2, "Organization name is too short.").max(255),
  address: z.string().trim().min(5, "Please enter the full address."),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  name: z.string().trim().min(2, "Please enter your name.").max(255),
  email: z.string().trim().email("Enter a valid email."),
  password: z.string().min(8, "Use at least 8 characters for the password."),
  role: z.enum(["donor", "recipient"]), // admin can never be self-assigned
});

export async function register(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = RegisterSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const passwordHash = await hashPassword(d.password);

  const client = await webPool.connect();
  let userId: string;
  try {
    await client.query("BEGIN");
    const org = await client.query<{ org_id: string }>(
      "INSERT INTO organizations (name, address, lat, lng) VALUES ($1, $2, $3, $4) RETURNING org_id",
      [d.orgName, d.address, d.lat, d.lng],
    );
    const user = await client.query<{ user_id: string }>(
      `INSERT INTO users (org_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING user_id`,
      [org.rows[0].org_id, d.name, d.email, passwordHash, d.role],
    );
    await client.query("COMMIT");
    userId = user.rows[0].user_id;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return { error: friendlyDbError(err) };
  } finally {
    client.release();
  }

  await startSession(userId);
  redirect(homeFor(d.role));
}
