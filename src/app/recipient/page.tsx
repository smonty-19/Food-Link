import type { Metadata } from "next";
import Link from "next/link";
import { actorOf, requireRole } from "@/lib/auth";
import { withActor } from "@/lib/db";
import { recipientAllocations, recipientRequirements, recipientStats } from "@/lib/queries/recipient";
import { num } from "@/lib/format";
import { toggleRequirement } from "@/actions/recipient";
import { ActionButton } from "@/components/action-button";
import { AllocationCard } from "@/components/recipient/allocation-card";
import { ButtonLink, Card, CardHeader, EmptyState, Page, PageHeader, Stat, TagList } from "@/components/ui";

export const metadata: Metadata = { title: "Overview" };

export default async function RecipientHome() {
  const user = await requireRole("recipient");
  const { requirements, allocations, stats } = await withActor(actorOf(user), async (c) => ({
    requirements: await recipientRequirements(c, user.orgId),
    allocations: await recipientAllocations(c, user.orgId),
    stats: await recipientStats(c, user.orgId),
  }));

  const open = allocations.filter((a) => a.status === "confirmed");
  const past = allocations.filter((a) => a.status !== "confirmed");

  return (
    <Page>
      <PageHeader
        title={user.orgName}
        subtitle="What you need, what's on its way, and what has arrived."
        action={
          <div className="flex gap-2">
            <ButtonLink href="/recipient/browse" variant="secondary">
              Browse food
            </ButtonLink>
            <ButtonLink href="/recipient/requirements/new">New requirement</ButtonLink>
          </div>
        }
      />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active requirements" value={num(stats.active_requirements)} />
        <Stat label="On its way" value={num(stats.open_allocations)} />
        <Stat label="Servings received" value={num(stats.servings_received)} />
        <Stat
          label="Pickups completed"
          value={stats.fulfilment_pct === null ? "—" : `${num(stats.fulfilment_pct)}%`}
          note="recipient_fulfilment_rate()"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="On its way" aside={<span className="text-sm text-muted">{open.length}</span>} />
            {open.length === 0 ? (
              <EmptyState title="Nothing claimed right now">
                Open one of your requirements to see matching food, or browse everything nearby.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {open.map((a) => (
                  <AllocationCard key={a.allocation_id} a={a} />
                ))}
              </ul>
            )}
          </Card>

          {past.length > 0 && (
            <Card>
              <CardHeader title="Earlier" />
              <ul className="divide-y divide-line">
                {past.map((a) => (
                  <AllocationCard key={a.allocation_id} a={a} />
                ))}
              </ul>
            </Card>
          )}
        </div>

        <Card className="self-start">
          <CardHeader title="Your requirements" />
          {requirements.length === 0 ? (
            <EmptyState title="No requirements yet">Add one so we can match food to it.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {requirements.map((r) => (
                <li key={r.requirement_id} className={`px-5 py-4 ${r.active ? "" : "opacity-60"}`}>
                  <Link href={`/recipient/requirements/${r.requirement_id}`} className="font-medium hover:text-brand">
                    {r.description}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <span>up to {num(r.max_capacity)} servings</span>
                    <span>{num(r.servings_received)} received</span>
                    {!r.active && <span>paused</span>}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <TagList tags={r.dietary_constraints} />
                    <ActionButton action={toggleRequirement} fields={{ requirementId: r.requirement_id }} variant="quiet" className="shrink-0">
                      {r.active ? "Pause" : "Resume"}
                    </ActionButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Page>
  );
}
