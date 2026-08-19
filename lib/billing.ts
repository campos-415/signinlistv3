// What a household owes, and what they've paid.
//
// Balances are per PHONE, not per dog: one family pays one bill covering
// every dog on the number. The dog profile shows the household's balance
// rather than inventing a per-dog split, because payments aren't taken
// per dog.

import { dateKey as localDateKey } from "@/lib/dates";
import { getSupabase } from "@/lib/supabase";
import { packageBillingPickUp } from "@/lib/dogs";
import { BathSize, Package, Payment, SignInRecord } from "@/types";
import { estimatePrice } from "@/lib/pricing";

export interface ChargeLine {
  key: string;
  date: string; // "YYYY-MM-DD" local
  label: string;
  amount: number;
  kind: "visit" | "package";
  /**
   * What made up the amount — "Daycare (half day)", "Bath (M)" and so on.
   *
   * Rebuilt rather than stored. estimatePrice produces this at sign-out and
   * only the TOTAL is saved, so the alternative was a column and a migration
   * that would explain nothing about the visits already on file. Every input
   * survives on the two sign-in rows, so the sum can be recomputed from them.
   *
   * Undefined when it could not be reconstructed to the cent. That is the
   * whole discipline here: a breakdown that disagrees with what the client
   * was charged is worse than no breakdown, because it invites staff to
   * "correct" a bill that was right.
   */
  items?: { label: string; amount: number }[];
}

export interface Balance {
  charges: ChargeLine[];
  charged: number;
  paid: number;
  /** Positive means the client still owes; negative means they're in credit. */
  outstanding: number;
  payments: Payment[];
}

function localDay(iso?: string | null): string {
  return iso ? localDateKey(new Date(iso)) : "";
}

// A package sale is charged to the visit it happened on, when there was
// one — performSignIn folds the price into that pick-up's saved total (see
// estimatePrice's packagesSold argument). Counting the package again here
// would bill the client twice for it, so a sale only becomes its own charge
// line when no priced pick-up happened that day.
function foldedIntoAVisit(pkg: Package, pickUps: SignInRecord[]): boolean {
  return packageBillingPickUp(pkg, pickUps) !== null;
}


/**
 * The lines behind one visit charge, or undefined if they cannot be proved.
 *
 * The drop-off row holds the add-ons, the bath size and the start time; the
 * pick-up holds the end time and the price. What neither records is whether a
 * package covered the base rate or the walk — that lived in memory at
 * sign-out. So rather than guess, this tries each combination and keeps the
 * one whose total matches what was actually charged. A single reconciling
 * answer is almost certainly the real one, and if nothing reconciles the
 * caller shows no breakdown at all.
 */
function visitItems(
  pickUp: SignInRecord,
  signins: SignInRecord[],
  packages: Package[]
): { label: string; amount: number }[] | undefined {
  if (pickUp.price == null || !pickUp.created_at) return undefined;

  // The drop-off this pick-up closes: the latest one for the same dog before
  // it. Matched on dog_id where both have one, falling back to the name for
  // rows written before dog_id was stored.
  const end = new Date(pickUp.created_at);
  const drop = signins
    .filter(
      (s) =>
        s.action === "drop_off" &&
        !!s.created_at &&
        new Date(s.created_at) <= end &&
        (s.dog_id && pickUp.dog_id
          ? s.dog_id === pickUp.dog_id
          : (s.dog_name ?? "").trim().toLowerCase() ===
            (pickUp.dog_name ?? "").trim().toLowerCase())
    )
    .sort((a, b) => new Date(b.created_at!).getTime() - new Date(a.created_at!).getTime())[0];
  if (!drop?.created_at) return undefined;

  // A package sold on this visit was folded into its price, so it has to go
  // back in or the total can never reconcile.
  const sold = packages
    .filter((pkg) => pkg.price != null && packageBillingPickUp(pkg, [pickUp])?.id === pickUp.id)
    .map((pkg) => ({
      days: pkg.total_days,
      price: pkg.price ?? 0,
      unit: (pkg.kind ?? "daycare") === "walk" ? "walks" : "days",
    }));

  const service = (drop.service_type ?? pickUp.service_type ?? "daycare") as
    | "daycare"
    | "boarding"
    | "meet_greet";

  for (const baseCovered of [false, true]) {
    for (const walkCovered of [false, true]) {
      for (const additionalDog of [false, true]) {
        const est = estimatePrice(
          service,
          new Date(drop.created_at),
          end,
          drop.addons ?? [],
          baseCovered,
          (drop.bath_size as BathSize | null) ?? null,
          true,
          sold.length ? sold : null,
          walkCovered,
          additionalDog
        );
        if (est && Math.abs(est.amount - pickUp.price) < 0.01) return est.breakdown;
      }
    }
  }
  return undefined;
}

export function computeBalance(
  signins: SignInRecord[],
  packages: Package[],
  payments: Payment[]
): Balance {
  const pickUps = signins.filter((s) => s.action === "pick_up");

  const charges: ChargeLine[] = [];

  for (const p of pickUps) {
    if (p.price == null) continue;
    charges.push({
      key: signinChargeKey(p.id ?? ""),
      date: localDay(p.created_at),
      label: `${p.dog_name} — ${String(p.service_type ?? "visit").replace("_", " ")}`,
      amount: p.price,
      kind: "visit",
      items: visitItems(p, signins, packages),
    });
  }

  for (const pkg of packages) {
    if (pkg.price == null) continue;
    if (foldedIntoAVisit(pkg, pickUps)) continue;
    const unit = (pkg.kind ?? "daycare") === "walk" ? "walks" : "days";
    charges.push({
      key: packageChargeKey(pkg.id ?? ""),
      date: localDay(pkg.created_at),
      label: `${pkg.dog_name || "Shared"} — package (${pkg.total_days} ${unit})`,
      amount: pkg.price,
      kind: "package",
    });
  }

  charges.sort((a, b) => b.date.localeCompare(a.date));

  const charged = charges.reduce((sum, c) => sum + c.amount, 0);
  const paid = payments.reduce((sum, p) => sum + (p.amount ?? 0), 0);

  return {
    charges,
    charged,
    paid,
    // Rounded to cents so floating-point noise never renders as a
    // fraction-of-a-penny balance on a settled account.
    outstanding: Math.round((charged - paid) * 100) / 100,
    payments: [...payments].sort((a, b) => b.paid_on.localeCompare(a.paid_on)),
  };
}

// Payments are read defensively everywhere: billing is additive, and a
// profile should still show its dogs, stays, and vaccines if the payments
// table is missing or unreachable. A failure here means "no payments known",
// not "this page is broken".
// Which charges are still unpaid, and how much of each remains.
//
// Payments aren't tied to a specific charge — a client hands over money and
// it settles the account — so they're applied oldest-charge-first. That's
// the conventional allocation and it means the dates shown as outstanding
// are the oldest ones, which is what a client expects to be reminded of.
/** The key a visit's charge is filed under. One definition, so nothing drifts. */
export const signinChargeKey = (id: string) => `signin-${id}`;
/** The key a package sale is filed under. */
export const packageChargeKey = (id: string) => `pkg-${id}`;

/**
 * How much is still owed on each individual charge, by key.
 *
 * Payments settle oldest first, so "is this one paid" is not a property of
 * the charge on its own — it depends on everything older than it. This runs
 * that allocation once and hands back the answer per charge, which is what
 * lets a price on screen be coloured for what it actually is.
 */
export function unpaidByKey(balance: Balance): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of unpaidCharges(balance)) out.set(c.key, c.remaining);
  return out;
}

export function unpaidCharges(balance: Balance): (ChargeLine & { remaining: number })[] {
  let pot = balance.paid;
  const oldestFirst = [...balance.charges].sort((a, b) => a.date.localeCompare(b.date));
  const out: (ChargeLine & { remaining: number })[] = [];
  for (const c of oldestFirst) {
    const applied = Math.min(pot, c.amount);
    pot -= applied;
    const remaining = Math.round((c.amount - applied) * 100) / 100;
    if (remaining > 0.005) out.push({ ...c, remaining });
  }
  return out.reverse(); // newest first for display
}

export async function loadPayments(phone: string): Promise<Payment[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("payments")
      .select("*")
      .eq("phone", phone)
      .order("paid_on", { ascending: false });
    if (error) throw error;
    return (data as Payment[]) ?? [];
  } catch (e) {
    console.error("Loading payments failed, treating as none:", e);
    return [];
  }
}

// Everything needed to show a household's balance, for callers that don't
// already have the visits and packages loaded (the dog profile does).
export async function loadBalanceFor(phone: string): Promise<Balance> {
  const supabase = getSupabase();
  const [signinRes, pkgRes, payments] = await Promise.all([
    // Not capped: a balance built from the first page of a long-standing
    // client's visits is a wrong number, not a partial one.
    supabase.from("signins").select("*").eq("phone", phone).limit(100000),
    supabase.from("packages").select("*").eq("phone", phone),
    loadPayments(phone),
  ]);
  if (signinRes.error) throw signinRes.error;
  if (pkgRes.error) throw pkgRes.error;
  return computeBalance(
    (signinRes.data as SignInRecord[]) ?? [],
    (pkgRes.data as Package[]) ?? [],
    payments
  );
}
