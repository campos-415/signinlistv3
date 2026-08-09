// Shared lookup rules for resolving a dog's profile and its package.
// Both were previously duplicated across app/records/page.tsx,
// components/KioskForm.tsx, and app/report/page.tsx — they live here so
// every page agrees on what "this dog's package" means.

import { dateKey as localDateKey } from "@/lib/dates";
import { Client, Package } from "@/types";

function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

export interface DogRef {
  clientId?: string | null;
  dogName?: string | null;
  phone?: string | null;
}

// Resolves a dog's client profile. Prefers client_id, since that's exact,
// and falls back to dog name + phone for rows written before the kiosk
// started recording client_id.
export function findClient(clients: Client[], ref: DogRef): Client | null {
  if (ref.clientId) {
    const byId = clients.find((c) => c.id === ref.clientId);
    if (byId) return byId;
  }
  if (ref.dogName && ref.phone) {
    return clients.find((c) => sameName(c.dog_name, ref.dogName) && c.phone === ref.phone) ?? null;
  }
  return null;
}

export function daysLeft(pkg: Package): number {
  return Math.max(0, pkg.total_days - pkg.days_used);
}

// A dog is covered either by a signature captured at signup, or by staff
// confirming a waiver signed elsewhere (paper, another location).
export function hasWaiver(client: Client): boolean {
  return !!client.signature_data || !!client.waiver_on_file;
}

// Every package that could cover a visit for this dog: ones bought
// specifically for them first, then ones with no dog_name, which are
// shared across every dog on the number. Packages with days remaining
// come before exhausted ones, and within each group the newest wins.
//
// A visit only ever consumes a day from ONE of these — see
// findPackageFor for the default pick and the kiosk's per-dog package
// selector for overriding it.
export function eligiblePackagesFor(packages: Package[], phone: string, dogName: string): Package[] {
  const rank = (p: Package) => {
    const dogSpecific = p.dog_name && sameName(p.dog_name, dogName) ? 0 : 1;
    const exhausted = daysLeft(p) > 0 ? 0 : 1;
    // Exhausted-vs-not dominates: a used-up dog-specific package
    // shouldn't outrank a shared one that still has days on it.
    return exhausted * 2 + dogSpecific;
  };
  return packages
    .filter((p) => p.phone === phone)
    .filter((p) => !p.dog_name || sameName(p.dog_name, dogName))
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
    );
}

// The package a visit draws from unless staff pick a different one.
export function findPackageFor(packages: Package[], phone: string, dogName: string): Package | null {
  return eligiblePackagesFor(packages, phone, dogName)[0] ?? null;
}

// A package this dog's household bought on a given day. The sale is what
// the client actually pays on that visit, so it belongs in that day's
// total — but only that day. Later visits just spend the days it bought,
// which are already paid for and bill at $0.
export function packageBoughtOn(
  packages: Package[],
  phone: string,
  dogName: string,
  dateKey: string
): Package | null {
  return (
    packages.find(
      (p) =>
        p.phone === phone &&
        (!p.dog_name || sameName(p.dog_name, dogName)) &&
        // created_at is a UTC timestamp; compare it in local time so an
        // evening sale isn't attributed to the next day.
        !!p.created_at &&
        localDateKey(new Date(p.created_at)) === dateKey &&
        p.price != null
    ) ?? null
  );
}

// A short label distinguishing one of a household's packages from another
// in a picker — "Bella · 6 of 10 left" vs "Shared · 2 of 5 left".
export function packageLabel(pkg: Package): string {
  const scope = pkg.dog_name ? pkg.dog_name : "Shared";
  return `${scope} · ${daysLeft(pkg)} of ${pkg.total_days} left`;
}

// Owner profiles are keyed by phone. The stored strings aren't all
// normalized (older rows predate formatPhoneInput), so the exact string is
// encoded into the route rather than reconstructed from digits.
export function ownerHref(phone: string): string {
  return `/owners/${encodeURIComponent(phone)}`;
}

export function dogHref(clientId: string): string {
  return `/dogs/${clientId}`;
}
