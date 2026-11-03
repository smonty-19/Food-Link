import type { Metadata } from "next";
import Link from "next/link";
import { actorOf, requireRole } from "@/lib/auth";
import { withActor } from "@/lib/db";
import { activeRequirementOptions } from "@/lib/queries/recipient";
import { browseDonations } from "@/lib/matching";
import { num } from "@/lib/format";
import { ClaimForm } from "@/components/recipient/claim-form";
import { MatchList } from "@/components/recipient/match-list";
import { DonationsMap } from "@/components/map";
import { Card, CardHeader, EmptyState, Notice, Page, PageHeader, buttonClass } from "@/components/ui";

export const metadata: Metadata = { title: "Browse food" };

const RADIUS_KM = 15;

export default async function BrowsePage({ searchParams }: PageProps<"/recipient/browse">) {
  const user = await requireRole("recipient");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 200) : "";

  const [{ matches, semantic }, requirements] = await Promise.all([
    browseDonations({ lat: user.lat, lng: user.lng, radiusKm: RADIUS_KM, excludeOrg: user.orgId, q }),
    withActor(actorOf(user), (c) => activeRequirementOptions(c, user.orgId)),
  ]);

  return (
    <Page>
      <PageHeader
        title="Browse food nearby"
        subtitle={`Everything open for pickup within ${RADIUS_KM} km of ${user.orgName}.`}
      />

      <form className="mb-6 flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={q}
          className="field max-w-xl flex-1"
          placeholder="Search by meaning, e.g. “something for breakfast” or “fresh vegetables”"
        />
        <button className={buttonClass("primary")}>Search</button>
        {q && (
          <Link href="/recipient/browse" className={buttonClass("quiet")}>
            Clear
          </Link>
        )}
      </form>

      {!semantic && (
        <div className="mb-6">
          <Notice tone="warn">The semantic index is offline, so search is showing everything nearby instead.</Notice>
        </div>
      )}
      {requirements.length === 0 && (
        <div className="mb-6">
          <Notice>
            To claim food you need an active requirement.{" "}
            <Link href="/recipient/requirements/new" className="underline">
              Add one
            </Link>
            .
          </Notice>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader
            title={q ? `Closest in meaning to “${q}”` : "Open listings"}
            aside={<span className="text-sm text-muted">{matches.length}</span>}
          />
          {matches.length === 0 ? (
            <EmptyState title="Nothing here right now">
              {q ? "No open listing nearby is close to that. Try other words." : "Check back later today."}
            </EmptyState>
          ) : (
            <MatchList
              matches={matches}
              renderAction={(m) =>
                requirements.length > 0 ? <ClaimForm donationId={m.donation_id} requirements={requirements} /> : null
              }
            />
          )}
        </Card>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <DonationsMap
            center={[user.lat, user.lng]}
            centerLabel={user.orgName}
            radiusKm={RADIUS_KM}
            points={matches.map((m) => ({
              id: m.donation_id,
              lat: m.pickup_lat,
              lng: m.pickup_lng,
              title: m.description,
              subtitle: `${m.donor_org} · ${num(m.servings)} servings`,
            }))}
          />
        </div>
      </div>
    </Page>
  );
}
