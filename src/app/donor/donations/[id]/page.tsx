import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { actorOf, requireRole } from "@/lib/auth";
import { withActor } from "@/lib/db";
import { UUID_RE } from "@/lib/form-state";
import { donationAllocations, donationDetail, donationItems } from "@/lib/queries/donor";
import { donationHistory } from "@/lib/queries/shared";
import { formatDateTime, num, timeLeft } from "@/lib/format";
import { cancelDonation, completePickup, markPickupMissed, publishDonation } from "@/actions/donor";
import { ActionButton } from "@/components/action-button";
import { Timeline } from "@/components/timeline";
import { DonationsMap } from "@/components/map";
import { Card, CardHeader, EmptyState, Notice, Page, PageHeader, StatusBadge, TagList } from "@/components/ui";

export const metadata: Metadata = { title: "Listing" };

export default async function DonationPage({ params }: PageProps<"/donor/donations/[id]">) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const user = await requireRole("donor");

  const data = await withActor(actorOf(user), async (c) => {
    const donation = await donationDetail(c, id);
    if (!donation || donation.org_id !== user.orgId) return null;
    return {
      donation,
      items: await donationItems(c, id),
      allocations: await donationAllocations(c, id),
      history: await donationHistory(c, id),
    };
  });
  if (!data) notFound();
  const { donation: d, items, allocations, history } = data;

  const active = allocations.find((a) => a.status !== "cancelled");
  const canCancel = ["DRAFT", "AVAILABLE", "ALLOCATED"].includes(d.status);
  const pickupOpen = active && active.status === "confirmed" && ["pending", "scheduled"].includes(active.pickup_status ?? "");

  return (
    <Page>
      <PageHeader
        back={{ href: "/donor", label: "My listings" }}
        title={d.description}
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <StatusBadge status={d.status} />
            <span>{num(d.servings)} servings</span>
            <span>·</span>
            <span>
              {["DRAFT", "AVAILABLE", "ALLOCATED"].includes(d.status) ? `expires ${timeLeft(d.expires_at)}` : `expiry ${formatDateTime(d.expires_at)}`}
            </span>
          </span>
        }
        action={
          <div className="flex gap-2">
            {d.status === "DRAFT" && (
              <ActionButton action={publishDonation} fields={{ donationId: d.donation_id }} variant="primary" pendingText="Publishing…">
                Publish
              </ActionButton>
            )}
            {canCancel && (
              <ActionButton
                action={cancelDonation}
                fields={{ donationId: d.donation_id }}
                variant="danger"
                confirm="Withdraw this listing? Any allocation will be cancelled."
                pendingText="Withdrawing…"
              >
                Withdraw
              </ActionButton>
            )}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Allocation" />
            {active ? (
              <div className="space-y-4 px-5 py-4 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-serif text-lg font-semibold">{active.recipient_org}</div>
                    <div className="text-muted">{active.recipient_address}</div>
                  </div>
                  <StatusBadge status={active.status} />
                </div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
                  <dt className="text-muted">For their requirement</dt>
                  <dd>{active.requirement}</dd>
                  <dt className="text-muted">Claimed by</dt>
                  <dd>
                    {active.allocated_by_name ?? "—"} · {formatDateTime(active.created_at)}
                  </dd>
                  <dt className="text-muted">Pickup</dt>
                  <dd className="flex items-center gap-2">
                    {active.pickup_status && <StatusBadge status={active.pickup_status} />}
                    {active.scheduled_at && <span>{formatDateTime(active.scheduled_at)}</span>}
                    {active.picked_up_at && <span>handed over {formatDateTime(active.picked_up_at)}</span>}
                  </dd>
                </dl>
                {pickupOpen && (
                  <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                    <ActionButton
                      action={completePickup}
                      fields={{ donationId: d.donation_id, allocationId: active.allocation_id }}
                      variant="primary"
                      pendingText="Saving…"
                    >
                      Food handed over
                    </ActionButton>
                    <ActionButton
                      action={markPickupMissed}
                      fields={{ donationId: d.donation_id, allocationId: active.allocation_id }}
                      variant="secondary"
                      confirm="Mark the pickup as missed? The food becomes available to others again."
                      pendingText="Saving…"
                    >
                      Nobody came
                    </ActionButton>
                  </div>
                )}
                {active.status === "confirmed" && active.pickup_status === "completed" && (
                  <Notice>Waiting for {active.recipient_org} to confirm the food arrived.</Notice>
                )}
              </div>
            ) : (
              <EmptyState title={d.status === "DRAFT" ? "Not published yet" : "Not claimed yet"}>
                {d.status === "DRAFT"
                  ? "Publish the listing to make it visible to recipients."
                  : d.status === "AVAILABLE"
                    ? "Recipients near you can see this listing and claim it."
                    : "This listing was never allocated."}
              </EmptyState>
            )}
            {allocations.filter((a) => a.status === "cancelled").length > 0 && (
              <p className="border-t border-line px-5 py-3 text-xs text-muted">
                Earlier cancelled allocations:{" "}
                {allocations
                  .filter((a) => a.status === "cancelled")
                  .map((a) => a.recipient_org)
                  .join(", ")}
              </p>
            )}
          </Card>

          <Card>
            <CardHeader title="What's in it" aside={<TagList tags={d.dietary_tags} />} />
            <ul className="divide-y divide-line text-sm">
              {items.map((it) => (
                <li key={it.name} className="flex justify-between px-5 py-2.5">
                  <span>{it.name}</span>
                  <span className="text-muted tabular-nums">
                    {num(it.quantity)} {it.unit}
                  </span>
                </li>
              ))}
              {items.length === 0 && <li className="px-5 py-3 text-muted">No items yet.</li>}
            </ul>
          </Card>

          <DonationsMap points={[]} center={[d.pickup_lat, d.pickup_lng]} centerLabel="Pickup point" height={240} />
        </div>

        <Card className="self-start">
          <CardHeader title="History" aside={<span className="text-xs text-muted">written by triggers</span>} />
          <Timeline entries={history} />
        </Card>
      </div>
    </Page>
  );
}
