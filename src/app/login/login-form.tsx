"use client";

import { useActionState } from "react";
import { login } from "@/actions/auth";
import { ErrorNote, Label } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export function LoginForm() {
  const [state, action] = useActionState(login, undefined);

  return (
    <form action={action} className="space-y-5">
      <label className="block">
        <Label>Email</Label>
        <input name="email" type="email" autoComplete="email" required className="field" />
      </label>
      <label className="block">
        <Label>Password</Label>
        <input name="password" type="password" autoComplete="current-password" required className="field" />
      </label>
      <ErrorNote message={state?.error} />
      <SubmitButton pendingText="Logging in…" className="w-full">
        Log in
      </SubmitButton>
    </form>
  );
}
