import type { ReactNode } from "react";
import type { Match } from "@/lib/matching";
import { num } from "@/lib/format";
import { TagList } from "@/components/ui";

/* A list of matching listings; `renderAction` supplies the claim control for each. */
export function MatchList({ matches, renderAction }: { matches: Match[]; renderAction: (m: Match) => ReactNode }) {
  return (
    <ol className="divide-y divide-line">
      {matches.map((m, i) => (
        <li key={m.donation_id} className="flex gap-4 px-5 py-4">
          <span className="w-5 shrink-0 pt-0.5 font-serif text-sm text-muted">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="font-medium">{m.description}</div>
            <div className="text-sm text-muted">
              {m.donor_org} · {num(m.servings)} servings · {num(m.distance_km)} km away · {num(m.hours_to_expiry)} h left
            </div>
            {m.items && <div className="mt-0.5 text-xs text-muted">{m.items}</div>}
            <div className="mt-2">
              <TagList tags={m.dietary_tags} />
            </div>
            <div className="mt-3">{renderAction(m)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
