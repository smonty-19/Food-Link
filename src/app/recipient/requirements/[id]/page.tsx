import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { actorOf, requireRole } from "@/lib/auth";
import { withActor } from "@/lib/db";
import { UUID_RE } from "@/lib/form-state";
import { requirementById } from "@/lib/queries/recipient";
import { matchesForRequirement } from "@/lib/matching";
import { num } from "@/lib/format";
import { toggleRequirement } from "@/actions/recipient";
import { ActionButton } from "@/components/action-button";
import { ClaimForm } from "@/components/recipient/claim-form";
import { MatchList } from "@/components/recipient/match-list";
import { DonationsMap } from "@/components/map";
import { Card, CardHeader, EmptyState, Notice, Page, PageHeader, TagList } from "@/components/ui";

export const metadata: Metadata = { title: "Matches" };

const RADII = [5, 10, 15, 25];

export default async function RequirementPage({ params, searchParams }: PageProps<"/recipient/requirements/[id]">) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const user = await requireRole("recipient");

  const sp = await searchParams;
  const radius = RADII.includes(Number(sp.radius)) ? Number(sp.radius) : 10;

  const requirement = await withActor(actorOf(user), (c) => requirementById(c, id, user.orgId));
  if (!requirement) notFound();

  // Stage 1 Qdrant (meaning) -> stage 2 PostgreSQL find_matching_donations (hard rules)
  const { matches, semantic } = requirement.active
    ? await matchesForRequirement(requirement, radius)
    : { matches: [], semantic: true };

  return (
    <Page>
      <PageHeader
        back={{ href: "/recipient", label: "Overview" }}
        title={requirement.description}
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <span>up to {num(requirement.max_capacity)} servings</span>
            <TagList tags={requirement.dietary_constraints} />
          </span>
        }
        action={
          <ActionButton action={toggleRequirement} fields={{ requirementId: id }} variant="secondary">
            {requirement.active ? "Pause requirement" : "Resume requirement"}
          </ActionButton>
        }
      />

      {!semantic && (
        <div className="mb-6">
          <Notice tone="warn">
            The semantic index is offline, so these matches come from PostgreSQL alone (ordered by expiry).
          </Notice>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader
            title="Best matches"
            aside={
              <form className="flex items-center gap-2 text-sm text-muted">
                within
                <select name="radius" defaultValue={radius} className="field w-auto py-1 text-sm">
                  {RADII.map((r) => (
                    <option key={r} value={r}>
                      {r} km
                    </option>
                  ))}
                </select>
                <button className="text-brand hover:underline">Update</button>
              </form>
            }
          />
          {!requirement.active ? (
            <EmptyState title="This requirement is paused">Resume it to see matching food again.</EmptyState>
          ) : matches.length === 0 ? (
            <EmptyState title="Nothing matches right now">
              No open listing within {radius} km fits this requirement&apos;s diet and capacity. Try a wider radius, or
              check back later.
            </EmptyState>
          ) : (
            <MatchList
              matches={matches}
              renderAction={(m) => <ClaimForm donationId={m.donation_id} fixedRequirementId={id} />}
            />
          )}
        </Card>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <DonationsMap
            center={[user.lat, user.lng]}
            centerLabel={user.orgName}
            radiusKm={radius}
            points={matches.map((m) => ({
              id: m.donation_id,
              lat: m.pickup_lat,
              lng: m.pickup_lng,
              title: m.description,
              subtitle: `${m.donor_org} · ${num(m.distance_km)} km`,
            }))}
          />
          <p className="mt-2 text-xs text-muted">
            Ranked by meaning (Qdrant), then filtered by availability, expiry, diet, capacity and distance (PostgreSQL).
          </p>
        </div>
      </div>
    </Page>
  );
}
