"use client";

import { useActionState } from "react";
import { schedulePickup } from "@/actions/recipient";
import { SubmitButton } from "@/components/submit-button";

/** Pick a pickup time (India time) for one allocation. */
export function ScheduleForm({ allocationId, label = "Schedule pickup" }: { allocationId: string; label?: string }) {
  const [state, action] = useActionState(schedulePickup, undefined);

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="allocationId" value={allocationId} />
      <input type="datetime-local" name="when" required className="field w-auto py-1.5 text-sm" />
      <SubmitButton variant="secondary" pendingText="Saving…">
        {label}
      </SubmitButton>
      {state?.error && <p className="w-full text-sm text-rose">{state.error}</p>}
      {state?.success && <p className="w-full text-sm text-leaf">{state.success}</p>}
    </form>
  );
}
