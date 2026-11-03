"use client";

import { useActionState } from "react";
import { createRequirement } from "@/actions/recipient";
import { ErrorNote, Label } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { DIETARY_TAGS, tagLabel } from "@/lib/format";

export function RequirementForm() {
  const [state, action] = useActionState(createRequirement, undefined);

  return (
    <form action={action} className="space-y-7">
      <label className="block">
        <Label>Description</Label>
        <textarea
          name="description"
          required
          rows={3}
          className="field resize-y"
          placeholder="e.g. Hot dinner for 40 children, soft food is fine"
        />
      </label>

      <label className="block max-w-xs">
        <Label hint="servings you can take at once">Capacity</Label>
        <input name="maxCapacity" type="number" min="1" step="1" required className="field" />
      </label>

      <fieldset>
        <Label>Must be</Label>
        <div className="flex flex-wrap gap-2">
          {DIETARY_TAGS.map((t) => (
            <label
              key={t}
              className="t-small cursor-pointer rounded-full bg-sand px-3.5 py-1.5 capitalize transition-colors has-checked:bg-brand has-checked:text-white"
            >
              <input type="checkbox" name="constraints" value={t} className="sr-only" />
              {tagLabel(t)}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">Leave all unticked if any food is fine.</p>
      </fieldset>

      <ErrorNote message={state?.error} />
      <div className="flex justify-end border-t border-line pt-5">
        <SubmitButton pendingText="Saving…">Save and find matches</SubmitButton>
      </div>
    </form>
  );
}
