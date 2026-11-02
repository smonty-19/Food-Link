/* Display helpers. All times are shown in India time. */

const TZ = "Asia/Kolkata";

export function formatDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(d));
}

/** "in 3 h 20 min", "in 45 min", or "expired 2 h ago" */
export function timeLeft(expiresAt: Date | string) {
  const mins = Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000);
  const abs = Math.abs(mins);
  const text = abs >= 60 * 24 ? `${Math.round(abs / 60 / 24)} d` : abs >= 60 ? `${Math.floor(abs / 60)} h ${abs % 60} min` : `${abs} min`;
  return mins >= 0 ? `in ${text}` : `${text} ago`;
}

export function num(n: string | number | null | undefined) {
  if (n === null || n === undefined) return "0";
  const v = Number(n);
  return Number.isInteger(v) ? v.toString() : v.toFixed(1);
}

export const DIETARY_TAGS = [
  "vegetarian",
  "vegan",
  "jain",
  "halal",
  "eggless",
  "nut_free",
  "gluten_free",
  "dairy_free",
] as const;

export function tagLabel(t: string) {
  return t.replaceAll("_", " ");
}
