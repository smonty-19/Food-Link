import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import {
  activeListingPlan,
  dailyActivity,
  donationStatusCounts,
  donorLeaderboard,
  housekeeping,
  recentAudit,
  recipientReliability,
  wasteByTimeOfDay,
} from "@/lib/queries/admin";
import { qdrant, COLLECTION } from "@/lib/qdrant";
import { formatDateTime, num } from "@/lib/format";
import { rebuildVectors, refreshImpact, runExpirySweep, syncVectors } from "@/actions/admin";
import { ActionButton } from "@/components/action-button";
import { ActivityChart } from "@/components/activity-chart";
import { ButtonLink, Card, CardHeader, Page, PageHeader, StatusBadge } from "@/components/ui";

export const metadata: Metadata = { title: "Platform" };

async function qdrantPoints(): Promise<number | null> {
  try {
    return (await qdrant.getCollection(COLLECTION)).points_count ?? 0;
  } catch {
    return null;
  }
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-muted">
            {head.map((h, i) => (
              <th key={h} className={`py-2.5 font-medium ${i === 0 ? "px-5" : "px-3"} ${i > 0 ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:py-2.5 [&_td:first-child]:px-5 [&_td:not(:first-child)]:px-3 [&_td:not(:first-child)]:text-right [&_td:not(:first-child)]:tabular-nums [&_tr]:border-b [&_tr]:border-line [&_tr:last-child]:border-0">
          {children}
        </tbody>
      </table>
    </div>
  );
}

function SqlNote({ children }: { children: ReactNode }) {
  return <p className="border-t border-line px-5 py-2.5 text-xs text-muted">{children}</p>;
}

export default async function AdminPage() {
  await requireRole("admin");
  const [statuses, hk, leaders, days, reliability, waste, plan, audit, points] = await Promise.all([
    donationStatusCounts(),
    housekeeping(),
    donorLeaderboard(),
    dailyActivity(),
    recipientReliability(),
    wasteByTimeOfDay(),
    activeListingPlan(),
    recentAudit(),
    qdrantPoints(),
  ]);

  const chartDays = days.map((d) => ({
    day: d.day,
    servings: Number(d.servings),
    listings: Number(d.listings),
    claims: Number(d.claims),
    running: Number(d.running_servings),
  }));

  return (
    <Page>
      <PageHeader
        title="Platform"
        subtitle="Health, maintenance and the analytical reports from db/reports.sql."
        action={<ButtonLink href="/admin/demo">Open concurrency demo</ButtonLink>}
      />

      {/* ---- maintenance ---- */}
      <Card className="mb-6">
        <CardHeader title="Maintenance" />
        <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              title: "Expiry sweep",
              text: `${num(hk.stale_live)} listing(s) past their deadline but not yet marked. Runs every minute automatically.`,
              action: runExpirySweep,
              label: "Run expire_stale_donations()",
            },
            {
              title: "Donor leaderboard",
              text: "mv_donor_impact is a materialized view. Refresh it concurrently, so readers are never blocked.",
              action: refreshImpact,
              label: "Refresh view",
            },
            {
              title: "Vector outbox",
              text: `${num(hk.outbox_pending)} change(s) waiting for Qdrant. Drained every 15 s with FOR UPDATE SKIP LOCKED.`,
              action: syncVectors,
              label: "Drain outbox now",
            },
            {
              title: "Qdrant index",
              text: points === null ? "Qdrant is not reachable." : `${points} vectors (id + embedding only, no payload).`,
              action: rebuildVectors,
              label: "Rebuild from Postgres",
            },
          ].map((m) => (
            <div key={m.title} className="flex flex-col bg-card px-5 py-4">
              <div className="font-medium">{m.title}</div>
              <p className="mt-1 mb-3 flex-1 text-sm text-muted">{m.text}</p>
              <ActionButton action={m.action} fields={{}} pendingText="Running…">
                {m.label}
              </ActionButton>
            </div>
          ))}
        </div>
      </Card>

      {/* ---- status + chart ---- */}
      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader title="Listings by status" aside={<span className="text-xs text-muted">{num(hk.sessions_active)} active sessions</span>} />
          <ul className="divide-y divide-line text-sm">
            {statuses.map((s) => (
              <li key={s.status} className="flex items-center justify-between px-5 py-2.5">
                <StatusBadge status={s.status} />
                <span className="tabular-nums">{num(s.n)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Servings delivered per day" aside={<span className="text-xs text-muted">last 14 days</span>} />
          <div className="px-4 pt-4 pb-2">
            <ActivityChart days={chartDays} />
          </div>
          <details className="border-t border-line px-5 py-2.5 text-sm">
            <summary className="cursor-pointer text-muted">Table view (running total with SUM() OVER)</summary>
            <table className="mt-2 w-full text-xs tabular-nums">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1">Day</th>
                  <th className="py-1 text-right">Listed</th>
                  <th className="py-1 text-right">Claimed</th>
                  <th className="py-1 text-right">Delivered</th>
                  <th className="py-1 text-right">Running</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.day}>
                    <td className="py-0.5">{d.day}</td>
                    <td className="text-right">{d.listings}</td>
                    <td className="text-right">{d.claims}</td>
                    <td className="text-right">{num(d.servings)}</td>
                    <td className="text-right">{num(d.running_servings)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </Card>
      </div>

      {/* ---- reports ---- */}
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Donor leaderboard" />
          <Table head={["Donor", "Rank", "Delivered", "Share", "Orgs fed", "Wasted"]}>
            {leaders.map((l) => (
              <tr key={l.donor_org}>
                <td>{l.donor_org}</td>
                <td>{l.impact_rank}</td>
                <td>{num(l.servings_delivered)}</td>
                <td>{l.share_pct === null ? "—" : `${num(l.share_pct)}%`}</td>
                <td>{num(l.recipients_served)}</td>
                <td>{l.waste_pct === null ? "—" : `${num(l.waste_pct)}%`}</td>
              </tr>
            ))}
          </Table>
          <SqlNote>DENSE_RANK() in mv_donor_impact; share = servings / SUM(servings) OVER ().</SqlNote>
        </Card>

        <Card>
          <CardHeader title="Recipient reliability" />
          <Table head={["Recipient", "Picked up", "Missed", "Missed %"]}>
            {reliability.map((r) => (
              <tr key={r.recipient_org}>
                <td>
                  {r.recipient_org}
                  {r.flagged && <span className="ml-2 rounded bg-rose-soft px-1.5 py-0.5 text-xs text-rose">over 20%</span>}
                </td>
                <td>{num(r.completed)}</td>
                <td>{num(r.missed)}</td>
                <td>{r.missed_pct === null ? "—" : `${num(r.missed_pct)}%`}</td>
              </tr>
            ))}
          </Table>
          <SqlNote>CTE over allocations ⋈ pickups with FILTER aggregates; flagged above 20%.</SqlNote>
        </Card>

        <Card>
          <CardHeader title="Waste by time posted" />
          <Table head={["Posted", "Listings", "Expired", "Servings lost"]}>
            {waste.map((w) => (
              <tr key={w.posted}>
                <td>{w.posted}</td>
                <td>{num(w.listings)}</td>
                <td>{num(w.expired)}</td>
                <td>{num(w.servings_wasted)}</td>
              </tr>
            ))}
          </Table>
          <SqlNote>Grouped by hour bucket of created_at; FILTER (WHERE status = &apos;EXPIRED&apos;).</SqlNote>
        </Card>

        <Card>
          <CardHeader title="Partial index in use" />
          <pre className="overflow-x-auto px-5 py-4 font-mono text-xs leading-relaxed">{plan.join("\n")}</pre>
          <SqlNote>
            idx_donations_available_expiry covers only AVAILABLE rows. Seq scans are disabled for this one transaction because the
            seed table is tiny.
          </SqlNote>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent lifecycle events" aside={<span className="text-xs text-muted">status_history, last 2 days</span>} />
        <Table head={["When", "Listing", "Change", "By", "DB role"]}>
          {audit.map((a, i) => (
            <tr key={i}>
              <td className="whitespace-nowrap">{formatDateTime(a.changed_at)}</td>
              <td className="max-w-64 truncate text-left!">{a.description ?? "—"}</td>
              <td className="text-left!">
                <span className="text-xs text-muted">{a.entity_type}</span> {a.old_status ?? "∅"} → {a.new_status}
              </td>
              <td className="text-left!">{a.changed_by ?? "system"}</td>
              <td className="text-left!">{a.db_user}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </Page>
  );
}
