import { Package } from "@/types";
import { dateKey } from "@/lib/dates";

/**
 * When a block of prepaid days stops being usable.
 *
 * Two sources, in order:
 *
 *   1. `expires_on` on the package — a manager extending (or shortening) this
 *      one block, for a family who were away or as a goodwill gesture.
 *   2. The business-wide duration in Settings, counted from the day it was
 *      sold. Zero means packages do not expire, which is the default and the
 *      state every install starts in.
 *
 * Computed rather than stamped onto rows. Turning the duration off, or
 * changing it, therefore puts every package back — which matters because the
 * thing being decided is when somebody stops being able to use days they have
 * already paid for, and that decision should be reversible by the person who
 * made it.
 */
export function packageExpiry(pkg: Package, expiryMonths: number): string | null {
  if (pkg.expires_on) return pkg.expires_on;
  if (!expiryMonths || expiryMonths <= 0) return null;
  if (!pkg.created_at) return null;

  const sold = new Date(pkg.created_at);
  if (Number.isNaN(sold.getTime())) return null;

  // Calendar months, not 30-day blocks: a package sold on the 15th expires on
  // the 15th, which is what a client is told and what they will count.
  const due = new Date(sold.getFullYear(), sold.getMonth() + expiryMonths, sold.getDate());
  // A short month rolls forward — 31 Jan plus one month lands on 2 or 3 March
  // rather than 28 Feb. Pulled back to the last day of the intended month so
  // it never lands in the month after the one the client expects.
  if (due.getDate() !== sold.getDate()) due.setDate(0);
  return dateKey(due);
}

/** True once the expiry date has passed. Expiry day itself is still usable. */
export function packageExpired(pkg: Package, expiryMonths: number, today = dateKey(new Date())): boolean {
  const expires = packageExpiry(pkg, expiryMonths);
  return !!expires && expires < today;
}

/**
 * Days that will be lost if nothing is done — what makes an expiry visible
 * before it costs somebody something, rather than after.
 */
export function daysAtRisk(pkg: Package): number {
  return Math.max(0, pkg.total_days - pkg.days_used);
}

/** How many days until it goes, or null when it does not expire. */
export function daysUntilExpiry(
  pkg: Package,
  expiryMonths: number,
  today = dateKey(new Date())
): number | null {
  const expires = packageExpiry(pkg, expiryMonths);
  if (!expires) return null;
  const ms = new Date(`${expires}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime();
  return Math.round(ms / 86_400_000);
}
