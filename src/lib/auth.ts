import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { query, type Actor } from "./db";

/*
 * Session auth backed by the `sessions` table (db/app_support.sql).
 * The cookie only carries a random session UUID; everything else is
 * looked up in Postgres on each request.
 */

export const SESSION_COOKIE = "fl_session";
const SESSION_DAYS = 7;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Role = "donor" | "recipient" | "admin";

export type SessionUser = {
  userId: string;
  name: string;
  email: string;
  role: Role;
  orgId: string;
  orgName: string;
  lat: number;
  lng: number;
};

export const getUser = cache(async (): Promise<SessionUser | null> => {
  const sid = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sid || !UUID_RE.test(sid)) return null;

  const rows = await query<SessionUser>(
    `SELECT u.user_id AS "userId", u.name, u.email, u.role,
            o.org_id AS "orgId", o.name AS "orgName", o.lat, o.lng
       FROM sessions s
       JOIN users u         ON u.user_id = s.user_id
       JOIN organizations o ON o.org_id  = u.org_id
      WHERE s.session_id = $1
        AND s.expires_at > now()
        AND u.is_active`,
    [sid],
  );
  return rows[0] ?? null;
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireRole(role: Role): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== role) redirect(homeFor(user.role));
  return user;
}

export function actorOf(user: SessionUser): Actor {
  return { userId: user.userId, orgId: user.orgId };
}

export function homeFor(role: Role): string {
  return role === "donor" ? "/donor" : role === "recipient" ? "/recipient" : "/admin";
}

// ---------- passwords ----------

/** Seed users from review2.sql carry SHA-256 hex hashes; new ones use bcrypt. */
const LEGACY_SHA256 = /^[0-9a-f]{64}$/;

export async function verifyPassword(password: string, stored: string) {
  if (LEGACY_SHA256.test(stored)) {
    const ok = createHash("sha256").update(password).digest("hex") === stored;
    return { ok, needsUpgrade: ok };
  }
  return { ok: await bcrypt.compare(password, stored), needsUpgrade: false };
}

export function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

// ---------- session lifecycle (call only from Server Actions) ----------

export async function startSession(userId: string) {
  const rows = await query<{ session_id: string; expires_at: Date }>(
    `INSERT INTO sessions (user_id, expires_at)
     VALUES ($1, now() + make_interval(days => $2))
     RETURNING session_id, expires_at`,
    [userId, SESSION_DAYS],
  );
  (await cookies()).set(SESSION_COOKIE, rows[0].session_id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: rows[0].expires_at,
  });
}

export async function endSession() {
  const store = await cookies();
  const sid = store.get(SESSION_COOKIE)?.value;
  if (sid && UUID_RE.test(sid)) {
    await query("DELETE FROM sessions WHERE session_id = $1", [sid]);
  }
  store.delete(SESSION_COOKIE);
}
