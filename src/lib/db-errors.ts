/*
 * Turn a PostgreSQL error into a message a person can act on.
 * node-postgres puts the SQLSTATE in `code` and the RAISE text in `message`.
 * Our stored functions raise P0001 (raise_exception), so those are matched
 * on their message text; everything else is matched on SQLSTATE.
 */

type PgError = { code?: string; message?: string; constraint?: string };

const RAISE_PATTERNS: [RegExp, string][] = [
  [/is not available \(status: (ALLOCATED|PICKED_UP|COMPLETED)/, "Another organization has just been allocated this listing."],
  [/is not available|expired at/, "This listing is no longer available."],
  [/does not meet the dietary needs/, "This listing doesn't meet that requirement's dietary needs."],
  [/above the capacity/, "This listing has more servings than that requirement can take."],
  [/cannot receive its own donation/, "You can't claim your own organization's listing."],
  [/not an active recipient/, "Only an active recipient of this organization can claim food."],
  [/no longer active/, "That requirement is paused. Turn it back on first."],
  [/cannot be published without any food items/, "Add at least one food item before publishing."],
  [/must be in the future|cannot be published: it expired/, "The expiry time must be in the future."],
  [/cannot list donations/, "Only donor accounts can list food."],
  [/Illegal status change|terminal/, "That change isn't allowed in the listing's current state."],
  [/cannot be completed before its pickup/, "Confirm receipt only after the pickup has been handed over."],
  [/already (completed|cancelled|missed)/, "This has already been closed."],
  [/not visible to this organization|not found/, "Not found, or it doesn't belong to your organization."],
];

export function friendlyDbError(err: unknown): string {
  const e = (err ?? {}) as PgError;
  const msg = e.message ?? "";

  if (e.code === "P0001") {
    for (const [re, text] of RAISE_PATTERNS) if (re.test(msg)) return text;
    return msg;
  }
  switch (e.code) {
    case "23505":
      if (e.constraint === "idx_allocations_one_active")
        return "Another organization has just been allocated this listing.";
      if (e.constraint?.includes("email")) return "An account with this email already exists.";
      return "That already exists.";
    case "23514":
      if (e.constraint === "chk_user_email_format") return "Please enter a valid email address.";
      if (e.constraint?.includes("coordinates")) return "Please pick a location on the map.";
      return "Some values are out of the allowed range.";
    case "42501":
      return "You don't have permission to do that.";
    case "22P02":
      return "Invalid identifier.";
    default:
      console.error("Unmapped database error", e.code, msg);
      return "Something went wrong. Please try again.";
  }
}
