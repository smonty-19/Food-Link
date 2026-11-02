import { Pool, type PoolClient, type QueryResultRow } from "pg";

/*
 * Two connection pools, two database roles (see db/review2.sql, Section 10):
 *
 *   webPool   -> foodlink_web (member of foodlink_app). Least privilege, subject
 *                to row-level security. Every user-facing query runs here.
 *   adminPool -> foodlink_dba (member of foodlink_admin). Reports, materialized
 *                view refresh and demo setup on the admin pages only.
 *
 * Pools are cached on globalThis so dev hot-reload does not open new ones.
 */

type Pools = { web?: Pool; admin?: Pool };
const g = globalThis as unknown as { __foodlinkPools?: Pools };
const pools: Pools = (g.__foodlinkPools ??= {});

export const webPool: Pool = (pools.web ??= new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 15, // the race demo needs one connection per concurrent claimer
}));

export const adminPool: Pool = (pools.admin ??= new Pool({
  connectionString: process.env.ADMIN_DATABASE_URL,
  max: 4,
}));

/** Who is acting. Becomes app.current_user_id / app.current_org_id in Postgres. */
export type Actor = { userId: string; orgId: string };

/** Plain query on the web role, outside any user context (RLS fails closed). */
export async function query<T extends QueryResultRow>(sql: string, params: unknown[] = []) {
  const res = await webPool.query<T>(sql, params);
  return res.rows;
}

/** Query on the admin role. Only call this behind requireRole("admin"). */
export async function adminQuery<T extends QueryResultRow>(sql: string, params: unknown[] = []) {
  const res = await adminPool.query<T>(sql, params);
  return res.rows;
}

/**
 * Run `fn` in one transaction with the actor's identity set for RLS policies
 * and audit triggers. set_config(..., true) is transaction-local, so a pooled
 * connection can never leak one user's identity into another request.
 */
export async function withActor<T>(actor: Actor, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await webPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.current_user_id', $1, true), set_config('app.current_org_id', $2, true)",
      [actor.userId, actor.orgId],
    );
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
