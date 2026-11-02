"use client";

import { useActionState } from "react";
import { runRaceDemo } from "@/actions/demo";
import { Card, CardHeader, ErrorNote, Label } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export function RacePanel() {
  const [state, action] = useActionState(runRaceDemo, undefined);
  const r = state?.result;
  const winners = r?.outcomes.filter((o) => o.ok).length ?? 0;
  const maxMs = Math.max(1, ...(r?.outcomes.map((o) => o.ms) ?? [1]));

  return (
    <Card>
      <CardHeader title="Run it" />
      <form action={action} className="flex flex-wrap items-end gap-6 px-5 py-4">
        <fieldset>
          <Label>Mode</Label>
          <div className="flex gap-2">
            {[
              ["safe", "Safe (FOR UPDATE)"],
              ["unsafe", "Unsafe (no lock)"],
            ].map(([v, l], i) => (
              <label
                key={v}
                className="t-small cursor-pointer rounded-full bg-sand px-4 py-2 transition-colors has-checked:bg-brand has-checked:text-white"
              >
                <input type="radio" name="mode" value={v} defaultChecked={i === 0} className="sr-only" />
                {l}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          <Label>Organizations claiming at once</Label>
          <select name="n" defaultValue="10" className="field w-28">
            {[2, 4, 6, 8, 10, 12].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <SubmitButton pendingText="Racing…">Create a listing and race</SubmitButton>
      </form>

      {state?.error && (
        <div className="px-5 pb-4">
          <ErrorNote message={state.error} />
        </div>
      )}

      {r && (
        <div className="border-t border-line">
          <div
            className={`flex flex-wrap items-center justify-between gap-4 px-5 py-4 ${r.correct ? "bg-leaf-soft" : "bg-rose-soft"}`}
          >
            <div>
              <div className={`t-title ${r.correct ? "text-leaf" : "text-rose"}`}>
                {r.correct ? "✓ Never over-allocated" : "✗ Over-allocated"}
              </div>
              <div className="text-sm">
                {r.mode === "safe" ? "Safe" : "Unsafe"} mode · {r.outcomes.length} claimers · {winners} winner
                {winners === 1 ? "" : "s"} · {r.activeAllocations} active allocation{r.activeAllocations === 1 ? "" : "s"} ·
                listing is now {r.finalStatus}
              </div>
            </div>
            <code className="text-xs text-muted">donation {r.donationId.slice(0, 8)}…</code>
          </div>

          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr className="border-b border-line">
                <th className="px-5 py-2.5 font-medium">#</th>
                <th className="px-3 py-2.5 font-medium">Organization</th>
                <th className="px-3 py-2.5 font-medium">Outcome</th>
                <th className="px-5 py-2.5 font-medium">Time in database</th>
              </tr>
            </thead>
            <tbody>
              {r.outcomes.map((o) => (
                <tr key={o.claimer} className="border-b border-line last:border-0">
                  <td className="px-5 py-2.5 text-muted tabular-nums">{o.claimer}</td>
                  <td className="px-3 py-2.5">{o.org}</td>
                  <td className={`px-3 py-2.5 ${o.ok ? "font-medium text-leaf" : "text-muted"}`}>
                    {o.ok ? "✓ allocated" : o.outcome}
                    {o.code && <span className="ml-2 font-mono text-xs">{o.code}</span>}
                  </td>
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 w-40 rounded-full bg-sand">
                        <div
                          className={`h-1.5 rounded-full ${o.ok ? "bg-leaf" : "bg-muted/50"}`}
                          style={{ width: `${(o.ms / maxMs) * 100}%` }}
                        />
                      </div>
                      <span className="tabular-nums">{o.ms} ms</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
