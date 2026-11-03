"use client";

import { useActionState } from "react";
import { claimDonation } from "@/actions/recipient";
import { SubmitButton } from "@/components/submit-button";

type Option = { requirement_id: string; description: string };

/*
 * Claim one listing for one of our requirements. The server action calls
 * allocate_donation(), which locks the donation row, so if two organizations
 * press this at the same moment exactly one of them gets it.
 */
export function ClaimForm({
  donationId,
  requirements,
  fixedRequirementId,
}: {
  donationId: string;
  requirements?: Option[];
  fixedRequirementId?: string;
}) {
  const [state, action] = useActionState(claimDonation, undefined);

  if (state?.success) return <p className="text-sm font-medium text-leaf">{state.success}</p>;

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="donationId" value={donationId} />
      {fixedRequirementId ? (
        <input type="hidden" name="requirementId" value={fixedRequirementId} />
      ) : (
        <select name="requirementId" required defaultValue="" className="field w-auto max-w-64 py-1.5 text-sm">
          <option value="" disabled>
            For which requirement?
          </option>
          {requirements?.map((r) => (
            <option key={r.requirement_id} value={r.requirement_id}>
              {r.description}
            </option>
          ))}
        </select>
      )}
      <SubmitButton pendingText="Claiming…">Claim</SubmitButton>
      {state?.error && <p className="w-full text-sm text-rose">{state.error}</p>}
    </form>
  );
}
