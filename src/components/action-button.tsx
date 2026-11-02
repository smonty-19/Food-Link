"use client";

import { useActionState } from "react";
import type { FormState } from "@/lib/form-state";
import { SubmitButton } from "./submit-button";
import type { buttonClass } from "./ui";

/*
 * A one-button form bound to a Server Action, with the action's error or
 * success message shown underneath. `fields` become hidden inputs.
 */
export function ActionButton({
  action,
  fields,
  children,
  pendingText,
  variant = "secondary",
  confirm,
  className = "",
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  fields: Record<string, string>;
  children: React.ReactNode;
  pendingText?: string;
  variant?: Parameters<typeof buttonClass>[0];
  confirm?: string;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);

  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton variant={variant} pendingText={pendingText}>
        {children}
      </SubmitButton>
      {state?.error && <p className="mt-2 text-sm text-rose">{state.error}</p>}
      {state?.success && <p className="mt-2 text-sm text-leaf">{state.success}</p>}
    </form>
  );
}
