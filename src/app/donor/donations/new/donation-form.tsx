"use client";

import { useActionState, useState } from "react";
import { createDonation } from "@/actions/donor";
import { ErrorNote, Label, buttonClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { LocationPicker } from "@/components/map";
import { DIETARY_TAGS, tagLabel } from "@/lib/format";

type Item = { name: string; quantity: string; unit: string };
const UNITS = ["portions", "plates", "packs", "packets", "kg", "litres", "loaves", "pieces", "boxes", "trays"];

export function DonationForm({ lat, lng }: { lat: number; lng: number }) {
  const [state, action] = useActionState(createDonation, undefined);
  const [items, setItems] = useState<Item[]>([{ name: "", quantity: "", unit: "portions" }]);

  const update = (i: number, patch: Partial<Item>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <form action={action} className="space-y-7">
      <label className="block">
        <Label>What is it?</Label>
        <input
          name="description"
          required
          className="field"
          placeholder="e.g. Veg pulao and raita from the lunch buffet, packed in trays"
        />
      </label>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <Label hint="roughly how many people">Servings</Label>
          <input name="servings" type="number" min="1" step="1" required className="field" />
        </label>
        <label className="block">
          <Label hint="hours from now">Good for</Label>
          <select name="validHours" defaultValue="6" className="field">
            {[1, 2, 3, 4, 6, 8, 12, 24, 48].map((h) => (
              <option key={h} value={h}>
                {h} {h === 1 ? "hour" : "hours"}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset>
        <Label>Dietary tags</Label>
        <div className="flex flex-wrap gap-2">
          {DIETARY_TAGS.map((t) => (
            <label
              key={t}
              className="cursor-pointer rounded-full border border-line px-3 py-1 text-sm capitalize has-checked:border-leaf has-checked:bg-leaf-soft has-checked:text-leaf"
            >
              <input type="checkbox" name="tags" value={t} className="sr-only" />
              {tagLabel(t)}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">Recipients only see food whose tags cover all of their requirements.</p>
      </fieldset>

      <fieldset>
        <Label>Food items</Label>
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-[1fr_5.5rem_7rem_auto] gap-2">
              <input
                aria-label="Item name"
                className="field"
                placeholder="Item"
                value={it.name}
                onChange={(e) => update(i, { name: e.target.value })}
              />
              <input
                aria-label="Quantity"
                className="field"
                type="number"
                min="0"
                step="any"
                placeholder="Qty"
                value={it.quantity}
                onChange={(e) => update(i, { quantity: e.target.value })}
              />
              <select aria-label="Unit" className="field" value={it.unit} onChange={(e) => update(i, { unit: e.target.value })}>
                {UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
              <button
                type="button"
                aria-label="Remove item"
                disabled={items.length === 1}
                onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}
                className="px-2 text-muted hover:text-rose disabled:opacity-30"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setItems((xs) => [...xs, { name: "", quantity: "", unit: "portions" }])}
          className={buttonClass("quiet", "mt-2 px-0")}
        >
          + Add another item
        </button>
        <input type="hidden" name="items" value={JSON.stringify(items)} />
      </fieldset>

      <div>
        <Label hint="defaults to your address">Pickup point</Label>
        <LocationPicker lat={lat} lng={lng} />
      </div>

      <ErrorNote message={state?.error} />

      <div className="flex flex-wrap justify-end gap-3 border-t border-line pt-5">
        <SubmitButton name="intent" value="draft" variant="secondary" pendingText="Saving…">
          Save as draft
        </SubmitButton>
        <SubmitButton name="intent" value="publish" pendingText="Publishing…">
          Publish now
        </SubmitButton>
      </div>
    </form>
  );
}
