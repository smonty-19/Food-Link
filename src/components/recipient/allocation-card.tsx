import type { RecipientAllocation } from "@/lib/queries/recipient";
import { cancelAllocation, confirmReceipt } from "@/actions/recipient";
import { formatDateTime, num, timeLeft } from "@/lib/format";
import { ActionButton } from "@/components/action-button";
import { StatusBadge, TagList } from "@/components/ui";
import { ScheduleForm } from "./schedule-form";

/*
 * One allocation and the next step for it:
 *   pickup pending/scheduled -> schedule (or reschedule), or release the food
 *   pickup completed         -> confirm the food arrived
 */
export function AllocationCard({ a }: { a: RecipientAllocation }) {
  const open = a.status === "confirmed";
  const awaitingPickup = open && (a.pickup_status === "pending" || a.pickup_status === "scheduled");
  const handedOver = open && a.pickup_status === "completed";

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{a.description}</div>
          <div className="text-sm text-muted">
            {num(a.servings)} servings from <span className="text-ink">{a.donor_org}</span>
            {a.donor_address && <> · {a.donor_address}</>}
          </div>
          <div className="mt-1.5">
            <TagList tags={a.dietary_tags} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {a.pickup_status && open && <StatusBadge status={a.pickup_status} />}
          <StatusBadge status={a.status} />
        </div>
      </div>

      <div className="mt-2 text-xs text-muted">
        For “{a.requirement}” · claimed {formatDateTime(a.created_at)}
        {open && <> · food expires {timeLeft(a.expires_at)}</>}
        {a.scheduled_at && <> · pickup {formatDateTime(a.scheduled_at)}</>}
        {a.picked_up_at && <> · handed over {formatDateTime(a.picked_up_at)}</>}
      </div>

      {awaitingPickup && (
        <div className="mt-3 flex flex-wrap items-start gap-3">
          <ScheduleForm allocationId={a.allocation_id} label={a.pickup_status === "scheduled" ? "Reschedule" : "Schedule pickup"} />
          <ActionButton
            action={cancelAllocation}
            fields={{ allocationId: a.allocation_id }}
            variant="quiet"
            confirm="Release this food so another organization can claim it?"
            pendingText="Releasing…"
          >
            Release it
          </ActionButton>
        </div>
      )}

      {handedOver && (
        <div className="mt-3">
          <ActionButton action={confirmReceipt} fields={{ allocationId: a.allocation_id }} variant="primary" pendingText="Saving…">
            Confirm it arrived
          </ActionButton>
        </div>
      )}
    </li>
  );
}
