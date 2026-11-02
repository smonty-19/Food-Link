import Link from "next/link";
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
    <div>
      {/* ---- hero ---- */}
      <section className="mx-auto max-w-[980px] px-5 pt-20 pb-16 text-center sm:pt-28">
        <p className="t-subhead font-semibold text-brand">FoodLink</p>
        <h1 className="t-hero mx-auto mt-3 max-w-[820px]">Good food shouldn&apos;t outlive the evening it was cooked for.</h1>
        <p className="t-subhead mx-auto mt-5 text-muted">
          Surplus food from local kitchens, shared with the shelters that need it.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
          <ButtonLink href="/register" className="px-[22px] py-[11px] text-[17px]">
            Register your organization
          </ButtonLink>
          <Link href="/login" className="text-[17px] text-brand hover:underline">
            Log in ›
          </Link>
        </div>
      </section>

      {/* ---- live numbers ---- */}
      <section className="mx-auto max-w-[1024px] px-5">
        <div className="grid gap-px overflow-hidden rounded-[18px] bg-line sm:grid-cols-3">
          {[
            [num(stats.live), "listings open for pickup now"],
            [num(stats.servings), "servings delivered"],
            [num(stats.donors), "kitchens that have listed food"],
          ].map(([value, label]) => (
            <div key={label} className="bg-card px-8 py-10 text-center">
              <div className="t-hero tabular-nums">{value}</div>
              <div className="t-small mt-2 text-muted">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- how it works ---- */}
      <section className="mx-auto max-w-[1024px] px-5 pt-24 pb-24">
        <h2 className="t-headline text-center">How it works.</h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {[
            ["List it.", "A donor describes the food, how many it serves, its dietary tags and when it must be eaten by."],
            [
              "Match it.",
              "Each recipient's requirement is matched by meaning, then checked against diet, capacity and distance.",
            ],
            ["Hand it over.", "The recipient schedules a pickup, the donor hands it over, and the recipient confirms it arrived."],
          ].map(([title, text], i) => (
            <div key={title} className="rounded-[18px] bg-card px-7 pt-7 pb-9">
              <div className="t-small font-semibold text-brand">Step {i + 1}</div>
              <h3 className="t-title mt-2">{title}</h3>
              <p className="mt-3 text-muted">{text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
