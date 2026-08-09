// The one place a sign-in or sign-out is written. Both the lobby kiosk
// (components/KioskForm.tsx) and the staff front-desk panel
// (components/StaffCheckIn.tsx) go through here, so package deduction,
// pricing, and the PetExec push can't drift apart between them.

import { getSupabase } from "@/lib/supabase";
import { estimatePrice, isFullDayVisit } from "@/lib/pricing";
import { todayKey } from "@/lib/dates";
import {
  BathSize,
  Boarding,
  Client,
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
  clients: Client[];
  packages: Package[];
  boardings: Boarding[];
  openVisits: Map<string, OpenVisit>;
}

// Everything both surfaces need about a phone number in one round trip.
export async function loadPhoneContext(phone: string): Promise<PhoneContext> {
  const supabase = getSupabase();
  const trimmed = phone.trim();
  const [pkgRes, clientRes, historyRes, boardingRes] = await Promise.all([
    supabase.from("packages").select("*").eq("phone", trimmed),
    supabase.from("clients").select("*").eq("phone", trimmed).order("created_at", { ascending: true }),
    // Not date-limited, for the multi-day boarding reason above.
    supabase
      .from("signins")
      .select("client_id, action, service_type, addons, bath_size, created_at")
      .eq("phone", trimmed)
      .order("created_at", { ascending: true })
      .limit(300),
    supabase.from("boardings").select("*").eq("phone", trimmed),
  ]);
  if (pkgRes.error) throw pkgRes.error;
  if (clientRes.error) throw clientRes.error;
  if (historyRes.error) throw historyRes.error;
  if (boardingRes.error) throw boardingRes.error;

  return {
    clients: (clientRes.data as Client[]) ?? [],
    packages: (pkgRes.data as Package[]) ?? [],
    boardings: (boardingRes.data as Boarding[]) ?? [],
    openVisits: buildOpenVisits((historyRes.data as SignInRecord[]) ?? []),
  };
}

// Walks history in order: the last drop-off and last pick-up per dog decide
// whether it's currently checked in, and under which service.
export function buildOpenVisits(rows: Partial<SignInRecord>[]): Map<string, OpenVisit> {
  const lastDropOff = new Map<string, OpenVisit>();
  const lastPickUp = new Map<string, Date>();
  for (const r of rows) {
    if (!r.client_id || !r.created_at) continue;
    if (r.action === "drop_off") {
      lastDropOff.set(r.client_id, {
        serviceType: (r.service_type as ServiceType) ?? "daycare",
        dropOffTime: new Date(r.created_at),
        addons: r.addons ?? [],
        bathSize: r.bath_size ?? null,
      });
    } else {
      lastPickUp.set(r.client_id, new Date(r.created_at));
    }
  }
  const open = new Map<string, OpenVisit>();
  lastDropOff.forEach((drop, clientId) => {
    const pickUp = lastPickUp.get(clientId);
    if (!pickUp || drop.dropOffTime > pickUp) open.set(clientId, drop);
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

export interface SignInInput {
  dog: Client;
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
  // A package bought on this same visit, which the client pays for now.
  packageSold?: { days: number; price: number } | null;
  byStaff?: boolean;
  now?: Date;
}

export interface SignInResult {
  dogName: string;
  daysLeft: number | null;
  priceDue: number | null;
  usedPackage: boolean;
}

export async function performSignIn(input: SignInInput): Promise<SignInResult> {
  const supabase = getSupabase();
  const now = input.now ?? new Date();
  const { dog, action, serviceType, addons, openVisit, pkg } = input;

  let usingPackage = false;
  let daysLeft: number | null = null;
  let priceDue: number | null = null;

  // Package days are only consumed at pick-up, once the visit length is
  // known — a full-day-only benefit can't be decided at drop-off.
  if (action === "pick_up" && pkg?.id && packageApplies(serviceType, openVisit, pkg, now)) {
    usingPackage = true;
    const newUsed = Math.min(pkg.total_days, pkg.days_used + 1);
    const { error: pkgErr } = await supabase
      .from("packages")
      .update({ days_used: newUsed })
      .eq("id", pkg.id);
    if (pkgErr) throw pkgErr;
    daysLeft = pkg.total_days - newUsed;

    // The counter says how many days are gone; this row says which day went
    // and to whom, so /packages can show real history. Not fatal if it
    // fails — the deduction itself already stuck.
    const { error: useErr } = await supabase.from("package_uses").insert({
      package_id: pkg.id,
      client_id: dog.id ?? null,
      dog_name: dog.dog_name,
      used_on: todayKey(),
    });
    if (useErr) console.error("Recording package use failed:", useErr);
  }

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
      input.packageSold ?? null
    );
    priceDue = estimate?.amount ?? null;
  }

  const { error: err } = await supabase.from("signins").insert({
    dog_name: dog.dog_name,
    phone: input.phone.trim(),
    drop_off_by: action === "drop_off" ? input.byName.trim() : "",
    pick_up_by: action === "pick_up" ? input.byName.trim() : "",
    last_name: dog.last_name,
    action,
    service_type: serviceType,
    addons,
    package_id: pkg?.id ?? null,
    client_id: dog.id,
    price: priceDue,
    pickup_window: action === "drop_off" ? (input.pickupWindow ?? null) : null,
    bath_size:
      action === "drop_off" && addons.includes("bath") ? (input.bathSize ?? null) : null,
    by_staff: !!input.byStaff,
    signature_data: "", // waiver already on file from signup
  });
  if (err) throw err;

  // Fire-and-forget: errors are only logged, so PetExec being unconfigured,
  // slow, or down never blocks a check-in.
  fetch("/api/petexec-checkin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dogName: dog.dog_name,
      lastName: dog.last_name,
      phone: input.phone.trim(),
      action,
      serviceType,
    }),
  }).catch((e) => console.error("PetExec sync failed:", e));

  return { dogName: dog.dog_name, daysLeft, priceDue, usedPackage: usingPackage };
}
