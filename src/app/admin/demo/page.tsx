import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { Card, CardHeader, Page, PageHeader } from "@/components/ui";
import { RacePanel } from "./race-panel";

export const metadata: Metadata = { title: "Concurrency demo" };

const SAFE_SQL = `-- allocate_donation (review2.sql)
SELECT * INTO v_d FROM donations
 WHERE donation_id = p_donation_id
   FOR UPDATE;            -- row lock: others queue here
IF v_d.status <> 'AVAILABLE' THEN
  RAISE EXCEPTION '... is not available';
END IF;
INSERT INTO allocations (...);`;

const UNSAFE_SQL = `-- allocate_donation_unsafe (demo only)
SELECT status INTO v_status FROM donations
 WHERE donation_id = p_donation_id;   -- NO LOCK
IF v_status <> 'AVAILABLE' THEN ... END IF;
PERFORM pg_sleep(0.3);                -- everyone passes
INSERT INTO allocations (...);
-- still stopped by trigger B.T1 and by
-- UNIQUE INDEX idx_allocations_one_active`;

export default async function DemoPage() {
  await requireRole("admin");
  return (
    <Page>
      <PageHeader
        back={{ href: "/admin", label: "Platform" }}
        title="Concurrency demo"
        subtitle="Several organizations claim the same listing at the same instant. The database must give it to exactly one."
      />

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Safe: row lock" />
          <pre className="overflow-x-auto px-5 py-4 font-mono text-xs leading-relaxed">{SAFE_SQL}</pre>
          <p className="border-t border-line px-5 py-3 text-sm text-muted">
            Claimers wait their turn on the row lock. Each one then sees the committed status of the one before it, so latency climbs
            claimer by claimer and the losers get a clean &quot;not available&quot;.
          </p>
        </Card>
        <Card>
          <CardHeader title="Unsafe: read, then write" />
          <pre className="overflow-x-auto px-5 py-4 font-mono text-xs leading-relaxed">{UNSAFE_SQL}</pre>
          <p className="border-t border-line px-5 py-3 text-sm text-muted">
            The check-then-write bug that application code often has. Every claimer passes the check, and only the
            database&apos;s own constraints stop a double allocation.
          </p>
        </Card>
      </div>

      <RacePanel />

      <Card className="mt-6">
        <CardHeader title="Two-browser version" />
        <ol className="list-decimal space-y-1.5 py-4 pr-5 pl-10 text-sm text-muted">
          <li>
            Set <code className="text-ink">DEMO_CLAIM_DELAY_MS=3000</code> in <code className="text-ink">.env</code> and restart the
            app. Every claim now holds the row lock for 3 seconds.
          </li>
          <li>
            Log in as two different recipients (e.g. <code className="text-ink">anita@akshaya.org</code> and{" "}
            <code className="text-ink">joseph@hopefoundation.org</code>, one in a private window).
          </li>
          <li>Open the same listing from Browse food in both, and press Claim in both within 3 seconds.</li>
          <li>The second window waits until the first commits, then shows &quot;Another organization has just been allocated this listing.&quot;</li>
        </ol>
      </Card>
    </Page>
  );
}
