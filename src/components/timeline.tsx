import type { HistoryEntry } from "@/lib/queries/shared";
import { formatDateTime } from "@/lib/format";
import { StatusBadge } from "./ui";

/* Renders status_history rows (written only by triggers) as a vertical timeline. */
export function Timeline({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) return <p className="px-5 py-6 text-sm text-muted">No history yet.</p>;

  return (
    <ol className="px-5 py-4">
      {entries.map((e, i) => (
        <li key={i} className="relative flex gap-4 pb-5 last:pb-0">
          <div className="flex flex-col items-center">
            <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${e.entity_type === "donation" ? "bg-brand" : "bg-leaf"}`} />
            {i < entries.length - 1 && <span className="mt-1 w-px flex-1 bg-line" />}
          </div>
          <div className="min-w-0 flex-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs tracking-wide text-muted uppercase">{e.entity_type}</span>
              {e.old_status && (
                <>
                  <StatusBadge status={e.old_status} />
                  <span className="text-muted">→</span>
                </>
              )}
              <StatusBadge status={e.new_status} />
            </div>
            <div className="mt-1 text-xs text-muted">
              {formatDateTime(e.changed_at)} · {e.changed_by_name ?? "system"} · db role {e.db_user}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
