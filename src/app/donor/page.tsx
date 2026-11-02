import type { Metadata } from "next";
import Link from "next/link";
import { actorOf, requireRole } from "@/lib/auth";
import { withActor } from "@/lib/db";
import { donorListings, donorStats } from "@/lib/queries/donor";
import { formatDateTime, num, timeLeft } from "@/lib/format";
import { ButtonLink, Card, CardHeader, EmptyState, Page, PageHeader, Stat, StatusBadge } from "@/components/ui";

export const metadata: Metadata = { title: "My listings" };

export default async function DonorHome() {
  const user = await requireRole("donor");
  const { listings, stats } = await withActor(actorOf(user), async (c) => ({
    listings: await donorListings(c, user.orgId),
    stats: await donorStats(c, user.orgId),
  }));

  return (
    <Page>
      <PageHeader
        title={user.orgName}
        subtitle="Your listings and where the food went."
        action={<ButtonLink href="/donor/donations/new">List surplus food</ButtonLink>}
      />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open right now" value={num(stats.live)} />
        <Stat label="Servings delivered" value={num(stats.servings_delivered)} note={`${num(stats.completed)} completed listings`} />
        <Stat label="Organizations fed" value={num(stats.recipients_served)} />
        <Stat
          label="Expired unused"
          value={stats.waste_pct === null ? "—" : `${num(stats.waste_pct)}%`}
          note="donor_waste_rate()"
        />
      </div>

      <Card>
        <CardHeader title="Listings" aside={<span className="text-sm text-muted">{listings.length} total</span>} />
        {listings.length === 0 ? (
          <EmptyState title="Nothing listed yet">
            When you have food left over, list it here and nearby organizations will be able to claim it.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr className="border-b border-line">
                  <th className="px-5 py-2.5 font-medium">Food</th>
                  <th className="px-3 py-2.5 font-medium">Servings</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Going to</th>
                  <th className="px-5 py-2.5 font-medium">Expires</th>
                </tr>
              </thead>
              <tbody>
                {listings.map((l) => {
                  const open = ["DRAFT", "AVAILABLE", "ALLOCATED"].includes(l.status);
                  return (
                    <tr key={l.donation_id} className="border-b border-line last:border-0 hover:bg-paper">
                      <td className="px-5 py-3">
                        <Link href={`/donor/donations/${l.donation_id}`} className="font-medium hover:text-brand">
                          {l.description}
                        </Link>
                        <div className="text-xs text-muted">Listed {formatDateTime(l.created_at)}</div>
                      </td>
                      <td className="px-3 py-3 tabular-nums">{num(l.servings)}</td>
                      <td className="px-3 py-3">
                        <StatusBadge status={l.status} />
                      </td>
                      <td className="px-3 py-3">
                        {l.recipient_org ?? <span className="text-muted">—</span>}
                        {l.pickup_status && <div className="text-xs text-muted">pickup {l.pickup_status}</div>}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        {open ? timeLeft(l.expires_at) : <span className="text-muted">{formatDateTime(l.expires_at)}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
