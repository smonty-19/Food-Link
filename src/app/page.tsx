import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui";
import { getUser, homeFor } from "@/lib/auth";
import { query } from "@/lib/db";
import { num } from "@/lib/format";

export default async function Home() {
  const user = await getUser();
  if (user) redirect(homeFor(user.role));

  const [stats] = await query<{ live: string; servings: string; donors: string }>(
    `SELECT count(*) FILTER (WHERE status = 'AVAILABLE' AND expires_at > now())   AS live,
            coalesce(sum(quantity) FILTER (WHERE status = 'COMPLETED'), 0)          AS servings,
            count(DISTINCT org_id)                                                  AS donors
       FROM donations`,
  );

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <section className="grid gap-12 py-16 md:grid-cols-[1.3fr_1fr] md:py-24">
        <div>
          <p className="mb-4 text-sm font-medium uppercase tracking-wider text-brand">Surplus food, shared fast</p>
          <h1 className="font-serif text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
            Good food shouldn&apos;t outlive the evening it was cooked for.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            Restaurants, caterers and canteens list what&apos;s left over. Shelters, orphanages and community kitchens
            nearby claim it before it expires. Each listing goes to exactly one organization, even when two of them click
            at the same moment.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/register">Register your organization</ButtonLink>
            <ButtonLink href="/login" variant="secondary">
              Log in
            </ButtonLink>
          </div>
        </div>

        <div className="self-end rounded-xl border border-line bg-card p-6">
          <p className="text-sm text-muted">On FoodLink right now</p>
          <dl className="mt-4 space-y-4">
            <div className="flex items-baseline justify-between border-b border-line pb-3">
              <dt>Listings open for pickup</dt>
              <dd className="font-serif text-2xl font-semibold">{num(stats.live)}</dd>
            </div>
            <div className="flex items-baseline justify-between border-b border-line pb-3">
              <dt>Servings delivered</dt>
              <dd className="font-serif text-2xl font-semibold">{num(stats.servings)}</dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt>Kitchens that have listed food</dt>
              <dd className="font-serif text-2xl font-semibold">{num(stats.donors)}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="grid gap-8 border-t border-line py-14 md:grid-cols-3">
        {[
          ["List it", "A donor describes the food, how many it serves, its dietary tags and when it must be eaten by."],
          [
            "Match it",
            "Each recipient's standing requirement is matched by meaning, then checked against diet, capacity and distance.",
          ],
          ["Hand it over", "The recipient schedules a pickup, the donor hands it over, and the recipient confirms it arrived."],
        ].map(([title, text], i) => (
          <div key={title}>
            <div className="font-serif text-sm text-brand">0{i + 1}</div>
            <h2 className="mt-1 font-serif text-xl font-semibold">{title}</h2>
            <p className="mt-2 text-muted">{text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
