// The one place a sign-in or sign-out is written. Both the lobby kiosk
// (components/KioskForm.tsx) and the staff front-desk panel
// (components/StaffCheckIn.tsx) go through here, so package deduction and
// pricing can't drift apart between them.

import { getSupabase } from "@/lib/supabase";
import { estimatePrice, isFullDayVisit } from "@/lib/pricing";
import { todayKey } from "@/lib/dates";
import {
  BathSize,
  Boarding,
  Dog,
  Package,
  ServiceType,
  SignAction,
  SignInRecord,
} from "@/types";

// A drop-off with no pick-up after it yet. Not limited to today — a
// boarding stay's drop-off can be several days before its pick-up.
export interface OpenVisit {
  serviceType: ServiceType;
  dropOffTime: Date;
  addons: string[];
  bathSize: BathSize | null;
}

export interface PhoneContext {
  dogs: Dog[];
  packages: Package[];
  boardings: Boarding[];
  openVisits: Map<string, OpenVisit>;
  // Raw history rows, needed to tell whether a package sale has already been
  // billed to an earlier pick-up today (see packageAlreadyBilled).
  history: Partial<SignInRecord>[];
}

// Everything both surfaces need about a phone number in one round trip.
export async function loadPhoneContext(phone: string): Promise<PhoneContext> {
  const supabase = getSupabase();
  const trimmed = phone.trim();
  const [pkgRes, dogRes, historyRes, boardingRes] = await Promise.all([
    supabase.from("packages").select("*").eq("phone", trimmed),
    supabase.from("dogs").select("*").eq("phone", trimmed).order("created_at", { ascending: true }),
    // Not date-limited, for the multi-day boarding reason above.
    supabase
      .from("signins")
      .select("id, dog_name, dog_id, action, service_type, addons, bath_size, price, created_at")
      .eq("phone", trimmed)
      .order("created_at", { ascending: true })
      .limit(300),
    supabase.from("boardings").select("*").eq("phone", trimmed),
  ]);
  if (pkgRes.error) throw pkgRes.error;
  if (dogRes.error) throw dogRes.error;
  if (historyRes.error) throw historyRes.error;
  if (boardingRes.error) throw boardingRes.error;

  return {
    dogs: (dogRes.data as Dog[]) ?? [],
    packages: (pkgRes.data as Package[]) ?? [],
    boardings: (boardingRes.data as Boarding[]) ?? [],
    openVisits: buildOpenVisits((historyRes.data as SignInRecord[]) ?? []),
    history: (historyRes.data as Partial<SignInRecord>[]) ?? [],
  };
}

// Walks history in order: the last drop-off and last pick-up per dog decide
// whether it's currently checked in, and under which service.
export function buildOpenVisits(rows: Partial<SignInRecord>[]): Map<string, OpenVisit> {
  const lastDropOff = new Map<string, OpenVisit>();
  const lastPickUp = new Map<string, Date>();
  for (const r of rows) {
    if (!r.dog_id || !r.created_at) continue;
    if (r.action === "drop_off") {
      lastDropOff.set(r.dog_id, {
        serviceType: (r.service_type as ServiceType) ?? "daycare",
        dropOffTime: new Date(r.created_at),
        addons: r.addons ?? [],
        bathSize: r.bath_size ?? null,
      });
    } else {
      lastPickUp.set(r.dog_id, new Date(r.created_at));
    }
  }
  const open = new Map<string, OpenVisit>();
  lastDropOff.forEach((drop, dogId) => {
    const pickUp = lastPickUp.get(dogId);
    if (!pickUp || drop.dropOffTime > pickUp) open.set(dogId, drop);
  });
  return open;
}

// A package only ever covers a FULL daycare day — a half day (4 hours or
// less) is billed as a walk-in half day whether or not one is on file.
export function packageApplies(
  serviceType: ServiceType,
  open: OpenVisit | null | undefined,
  pkg: Package | null | undefined,
  now: Date
): boolean {
  if (!pkg || !open) return false;
  if (serviceType !== "daycare") return false;
  return isFullDayVisit(open.dropOffTime, now);
}

// A walk package covers the walk add-on on a daycare visit. Unlike a
// daycare package it doesn't care how long the dog stayed — a walk is a
// walk — it only needs a walk to have actually been booked, and uses left.
export function walkPackageApplies(
  open: OpenVisit | null | undefined,
  walkPkg: Package | null | undefined
): boolean {
  if (!walkPkg || !open) return false;
  if (!(open.addons ?? []).includes("walk")) return false;
  return walkPkg.total_days - walkPkg.days_used > 0;
}

export interface SignInInput {
  dog: Dog;
  action: SignAction;
  serviceType: ServiceType;
  phone: string;
  byName: string; // who handed the dog over / collected it
  addons: string[];
  pickupWindow?: string | null;
  // Bath size for a drop-off, when it's already known — a boarding
  // reservation books one, so the visit shouldn't wait for staff to retype
  // it on /records before the bath can be priced. Null for a walk-in bath,
  // which genuinely has no price until staff size it.
  bathSize?: BathSize | null;
  openVisit?: OpenVisit | null;
  // Which package this visit should draw from, when one applies. Staff can
  // override the default pick; see eligiblePackagesFor in lib/clients.ts.
  pkg?: Package | null;
  // The walk package this visit's walk add-on should draw from, if any.
  walkPkg?: Package | null;
  // Packages bought on this same visit, which the client pays for now.
  packagesSold?: { days: number; price: number; unit?: string }[] | null;
  byStaff?: boolean;
  now?: Date;
}

export interface SignInResult {
  dogName: string;
  daysLeft: number | null;
  priceDue: number | null;
  usedPackage: boolean;
  usedWalkPackage: boolean;
}

export async function performSignIn(input: SignInInput): Promise<SignInResult> {
  const supabase = getSupabase();
  const now = input.now ?? new Date();
  const { dog, action, serviceType, addons, openVisit, pkg } = input;

  let usingPackage = false;
  let usingWalkPackage = false;
  let daysLeft: number | null = null;
  let priceDue: number | null = null;

  // Package days are only consumed at pick-up, once the visit length is
  // known — a full-day-only benefit can't be decided at drop-off.
  // Consumes one use from a package and records it in the ledger. Shared by
  // daycare and walk packages — the only difference is what triggers it.
  // Decided up front so pricing knows, but only written after the sign-in
  // row exists — the ledger rows carry its id so a use is tied to one exact
  // visit rather than guessed at by date.
  usingWalkPackage =
    action === "pick_up" && !!input.walkPkg?.id && walkPackageApplies(openVisit, input.walkPkg);
  usingPackage =
    action === "pick_up" && !!pkg?.id && packageApplies(serviceType, openVisit, pkg, now);
  if (usingPackage && pkg) daysLeft = pkg.total_days - Math.min(pkg.total_days, pkg.days_used + 1);

  // A package only covers the base full-day rate, so add-ons still apply on
  // top. Boarding never uses packages and always gets its nightly math.
  if (action === "pick_up" && openVisit) {
    const estimate = estimatePrice(
      serviceType,
      openVisit.dropOffTime,
      now,
      openVisit.addons,
      usingPackage,
      openVisit.bathSize,
      true,
      // Keeps the recorded price matching the estimate the client was
      // shown. /daily counts package sales as their own category and
      // doesn't sum signin prices into revenue, so this can't double-count.
      input.packagesSold ?? null,
      usingWalkPackage
    );
    priceDue = estimate?.amount ?? null;
  }

  const { data: inserted, error: err } = await supabase.from("signins").insert({
    dog_name: dog.dog_name,
    phone: input.phone.trim(),
    drop_off_by: action === "drop_off" ? input.byName.trim() : "",
    pick_up_by: action === "pick_up" ? input.byName.trim() : "",
    last_name: dog.last_name,
    action,
    service_type: serviceType,
    addons,
    package_id: pkg?.id ?? null,
    dog_id: dog.id,
    price: priceDue,
    pickup_window: action === "drop_off" ? (input.pickupWindow ?? null) : null,
    bath_size:
      action === "drop_off" && addons.includes("bath") ? (input.bathSize ?? null) : null,
    by_staff: !!input.byStaff,
    signature_data: "", // waiver already on file from signup
  })
    .select("id")
    .single();
  if (err) throw err;

  const signinId = (inserted as { id?: string } | null)?.id ?? null;

  // Consumes one use and records it against this visit. Shared by daycare and
  // walk packages — only the trigger differs.
  async function consume(target: Package) {
    const newUsed = Math.min(target.total_days, target.days_used + 1);
    const { error: pkgErr } = await supabase
      .from("packages")
      .update({ days_used: newUsed })
      .eq("id", target.id);
    if (pkgErr) {
      console.error("Deducting the package failed:", pkgErr);
      return;
    }
    const { error: useErr } = await supabase.from("package_uses").insert({
      package_id: target.id,
      dog_id: dog.id ?? null,
      signin_id: signinId,
      dog_name: dog.dog_name,
      used_on: todayKey(),
    });
    // Not fatal — the deduction itself already stuck.
    if (useErr) console.error("Recording package use failed:", useErr);
  }

  if (usingWalkPackage && input.walkPkg) await consume(input.walkPkg);
  if (usingPackage && pkg) await consume(pkg);

  return {
    dogName: dog.dog_name,
    daysLeft,
    priceDue,
    usedPackage: usingPackage,
    usedWalkPackage: usingWalkPackage,
  };
}
