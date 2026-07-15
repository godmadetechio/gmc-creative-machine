const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: "week", ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: "day", ms: 24 * 60 * 60 * 1000 },
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
];

// "3 days ago" / "yesterday" / "just now". Pure Intl — safe in server
// components.
export function relativeTime(iso: string, now = Date.now()): string {
  const delta = new Date(iso).getTime() - now;
  const magnitude = Math.abs(delta);
  for (const { unit, ms } of UNITS) {
    if (magnitude >= ms) {
      return rtf.format(Math.round(delta / ms), unit);
    }
  }
  return "just now";
}
