"use client";

import { useActionState } from "react";
import { register } from "@/actions/auth";
import { ErrorNote, Label } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { LocationPicker } from "@/components/map";

const BENGALURU: [number, number] = [12.9716, 77.5946];

export function RegisterForm() {
  const [state, action] = useActionState(register, undefined);

  return (
    <form action={action} className="space-y-8">
      <fieldset className="space-y-5">
        <legend className="t-card-title mb-1">What does your organization do?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ["donor", "We have surplus food", "Restaurant, hotel, caterer, canteen, store"],
            ["recipient", "We feed people", "Shelter, orphanage, NGO, community kitchen"],
          ].map(([value, title, hint], i) => (
            <label
              key={value}
              className="flex cursor-pointer gap-3 rounded-[14px] border border-line p-4 transition-colors has-checked:border-brand has-checked:bg-brand-soft/50"
            >
              <input type="radio" name="role" value={value} defaultChecked={i === 0} className="mt-1 accent-brand" />
              <span>
                <span className="block font-medium">{title}</span>
                <span className="t-small text-muted">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="t-card-title mb-1">Organization</legend>
        <label className="block">
          <Label>Name</Label>
          <input name="orgName" required className="field" placeholder="e.g. Akshaya Shelter Home" />
        </label>
        <label className="block">
          <Label>Address</Label>
          <input name="address" required className="field" placeholder="Street, area, Bengaluru" />
        </label>
        <div>
          <Label hint="used for distance matching">Location</Label>
          <LocationPicker lat={BENGALURU[0]} lng={BENGALURU[1]} />
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="t-card-title mb-1">Your account</legend>
        <label className="block">
          <Label>Your name</Label>
          <input name="name" required autoComplete="name" className="field" />
        </label>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block">
            <Label>Email</Label>
            <input name="email" type="email" required autoComplete="email" className="field" />
          </label>
          <label className="block">
            <Label hint="8+ characters">Password</Label>
            <input name="password" type="password" required minLength={8} autoComplete="new-password" className="field" />
          </label>
        </div>
      </fieldset>

      <ErrorNote message={state?.error} />
      <SubmitButton pendingText="Creating account…" className="w-full">
        Create account
      </SubmitButton>
    </form>
  );
}
