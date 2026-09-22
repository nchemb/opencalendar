import { DateTime } from "luxon";

export function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** "3:45 PM" or "15:45" depending on the invitee's clock preference. */
export function formatTime(dt: DateTime, hour12: boolean): string {
  return dt.toFormat(hour12 ? "h:mm a" : "HH:mm");
}

/** Best-effort locale default: most locales are 24h; a handful (mostly en-US/CA/AU) are 12h. */
export function detectHour12(): boolean {
  try {
    const opts = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions();
    return opts.hour12 !== false;
  } catch {
    return true;
  }
}
