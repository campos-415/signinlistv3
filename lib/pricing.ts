import { getSettings } from "@/lib/settings";

// -----------------------------------------------------------------------
// Walk-in pricing. Covers daycare/boarding base rate, walk/nail-trim
// (fixed the moment picked at drop-off), and bath (priced by size,
// assigned on /records — can happen any time, even mid-visit, and once
// set it's included here too). Returns a structured breakdown so the UI
// can show a line-by-line total, not just one number.
// -----------------------------------------------------------------------

// Every price below is read live from the settings row (lib/settings.ts)
// rather than baked in, so staff can change them on /settings. They're
// exposed as getter objects so existing call sites — PRICING.daycareFullDay,
// BATH_PRICES[size] — keep working untouched, and every pricing function
// here stays pure and synchronous.

export const PRICING = {
  get daycareFullDay() {
    return getSettings().pricing.daycareFullDay;
  },
  get daycareHalfDay() {
    return getSettings().pricing.daycareHalfDay;
  },
  get daycareHalfDayThresholdHours() {
    return getSettings().pricing.daycareHalfDayThresholdHours;
  },
  get boardingPerNight() {
    return getSettings().pricing.boardingPerNight;
  },
  get latePickupHour() {
    return getSettings().pricing.latePickupHour;
  },
  get latePickupFee() {
    return getSettings().pricing.latePickupFee;
  },
};

// Walk-in add-on prices, applied once selected at drop-off. Indexed by
// add-on key so custom add-ons created on /settings price themselves.
export const ADDON_PRICES: Record<string, number> = new Proxy(
  {},
  {
    get: (_t, key: string) => getSettings().pricing.addons[key] ?? 0,
    has: (_t, key: string) => key in getSettings().pricing.addons,
    ownKeys: () => Reflect.ownKeys(getSettings().pricing.addons),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  }
);

// Bath is priced by size. A boarding reservation books a size, so those
// carry onto the sign-in automatically (see lib/signin.ts); a walk-in bath
// has no size until staff assign one on /records, and until then no bath
// charge applies — /records flags those rows so they can't slip through.
export const BATH_PRICES: Record<"S" | "M" | "L", number> = {
  get S() {
    return getSettings().pricing.bath.S;
  },
  get M() {
    return getSettings().pricing.bath.M;
  },
  get L() {
    return getSettings().pricing.bath.L;
  },
};

// Boarding add-on pricing. Walk is per walk (so a stay with 2 walks/day
// over 3 nights charges 6 walks); medication is a flat daily fee for
// the whole stay; nail trim is a flat one-time fee for the stay.
export const BOARDING_ADDON_PRICES = {
  get walkPerWalk() {
    return getSettings().pricing.boardingWalkPerWalk;
  },
  get medicationPerDay() {
    return getSettings().pricing.boardingMedicationPerDay;
  },
  get nailTrim() {
    return getSettings().pricing.boardingNailTrim;
  },
};

export interface BoardingAddonInput {
  addons: string[];
  walksPerDay?: number | null;
  bathSize?: "S" | "M" | "L" | null;
}

// A dog's package only covers a visit's base rate when the visit is a
// FULL day. A half-day (4 hours or less) visit is never covered by a
// package — it's always billed as a walk-in half day — so this returns
// false in that case even when hasPackage is true.
export function isBaseCoveredByPackage(
  hasPackage: boolean,
  dropOffTime: Date,
  pickUpTime: Date
): boolean {
  if (!hasPackage) return false;
  return isFullDayVisit(dropOffTime, pickUpTime);
}

// Price breakdown for a boarding reservation's add-ons only (not the
// nightly rate itself — combine with PRICING.boardingPerNight * nights
// separately, e.g. in estimateBoardingTotal below).
export function estimateBoardingAddons(input: BoardingAddonInput, nights: number): PriceBreakdownItem[] {
  const breakdown: PriceBreakdownItem[] = [];
  const addons = input.addons ?? [];
  if (addons.includes("walk")) {
    const perDay = Math.max(1, input.walksPerDay || 1);
    const totalWalks = perDay * nights;
    breakdown.push({
      label: `Walks (${perDay}/day × ${nights} night${nights === 1 ? "" : "s"})`,
      amount: totalWalks * BOARDING_ADDON_PRICES.walkPerWalk,
    });
  }
  if (addons.includes("bath") && input.bathSize) {
    breakdown.push({ label: `Bath (${input.bathSize})`, amount: BATH_PRICES[input.bathSize] });
  }
  if (addons.includes("nail_trim")) {
    breakdown.push({ label: "Nail trim", amount: BOARDING_ADDON_PRICES.nailTrim });
  }
  if (addons.includes("medication")) {
    breakdown.push({
      label: `Medication (${nights} night${nights === 1 ? "" : "s"})`,
      amount: nights * BOARDING_ADDON_PRICES.medicationPerDay,
    });
  }
  return breakdown;
}

// Full estimate for a boarding reservation: nightly rate + add-ons.
export function estimateBoardingTotal(
  startDate: string,
  endDate: string,
  addonInput: BoardingAddonInput
): PriceEstimate {
  const nights = Math.max(
    1,
    Math.round((parseYmd(endDate).getTime() - parseYmd(startDate).getTime()) / 86_400_000)
  );
  const breakdown: PriceBreakdownItem[] = [
    { label: `Boarding (${nights} night${nights === 1 ? "" : "s"})`, amount: nights * PRICING.boardingPerNight },
    ...estimateBoardingAddons(addonInput, nights),
  ];
  const amount = breakdown.reduce((sum, b) => sum + b.amount, 0);
  return { amount, label: breakdown.map((b) => b.label).join(" + "), breakdown };
}

function parseYmd(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export interface PriceBreakdownItem {
  label: string;
  amount: number;
}

export interface PriceEstimate {
  amount: number;
  label: string; // short combined label, e.g. "full day + walk + bath (M)"
  breakdown: PriceBreakdownItem[];
}

// Whole calendar nights between two dates, minimum 1 (a same-day boarding
// drop-off/pick-up still counts as at least one night).
function nightsBetween(dropOff: Date, pickUp: Date): number {
  const start = new Date(dropOff.getFullYear(), dropOff.getMonth(), dropOff.getDate());
  const end = new Date(pickUp.getFullYear(), pickUp.getMonth(), pickUp.getDate());
  const nights = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return Math.max(1, nights);
}

// A package only ever covers a FULL daycare day — a half-day (4 hours or
// less) visit is always billed as a walk-in half day, package or not.
export function isFullDayVisit(dropOffTime: Date, pickUpTime: Date): boolean {
  const hours = (pickUpTime.getTime() - dropOffTime.getTime()) / 3_600_000;
  return hours > PRICING.daycareHalfDayThresholdHours;
}

export function estimatePrice(
  serviceType: "daycare" | "boarding" | "meet_greet",
  dropOffTime: Date,
  pickUpTime: Date,
  addons: string[] = [],
  baseCovered: boolean = false, // true only when a package covers this visit's FULL-DAY daycare rate
  bathSize: "S" | "M" | "L" | null = null,
  // Whether `pickUpTime` is the real end of the stay rather than a
  // stand-in "now". Only matters for boarding: the late-pickup daycare
  // fee is a last-day charge, so a running mid-stay estimate must not
  // add it just because the clock has passed noon on some earlier day.
  isFinalPickUp: boolean = true,
  // A package the client bought on this visit. The sale is money changing
  // hands today, so it belongs in today's total — but only today. Later
  // visits merely spend days that were already paid for.
  packageSold: { days: number; price: number } | null = null
): PriceEstimate | null {
  const breakdown: PriceBreakdownItem[] = [];

  if (packageSold) {
    breakdown.push({
      label: `Package (${packageSold.days} days)`,
      amount: packageSold.price,
    });
  }

  if (baseCovered) {
    // The package absorbs the full-day rate. Show it as a $0 line rather
    // than dropping it: silently omitting the base makes the total look
    // like the daycare charge went missing, and a package-covered day with
    // no add-ons would otherwise produce no breakdown at all.
    breakdown.push({ label: "Daycare (full day) — covered by package", amount: 0 });
  } else {
    if (serviceType === "daycare") {
      const fullDay = isFullDayVisit(dropOffTime, pickUpTime);
      breakdown.push(
        fullDay
          ? { label: "Daycare (full day)", amount: PRICING.daycareFullDay }
          : { label: "Daycare (half day)", amount: PRICING.daycareHalfDay }
      );
    } else if (serviceType === "boarding") {
      const nights = nightsBetween(dropOffTime, pickUpTime);
      breakdown.push({
        label: `Boarding (${nights} night${nights === 1 ? "" : "s"})`,
        amount: nights * PRICING.boardingPerNight,
      });
      // Charged once, on the day the dog actually goes home after noon.
      if (isFinalPickUp && pickUpTime.getHours() >= PRICING.latePickupHour) {
        breakdown.push({ label: "Daycare fee (after 12PM)", amount: PRICING.latePickupFee });
      }
    }
  }

  if (addons.includes("walk")) breakdown.push({ label: "Walk", amount: ADDON_PRICES.walk });
  if (addons.includes("nail_trim")) breakdown.push({ label: "Nail trim", amount: ADDON_PRICES.nail_trim });
  if (bathSize) breakdown.push({ label: `Bath (${bathSize})`, amount: BATH_PRICES[bathSize] });

  if (!breakdown.length) return null;

  const amount = breakdown.reduce((sum, b) => sum + b.amount, 0);
  const label = breakdown.map((b) => b.label).join(" + ");
  return { amount, label, breakdown };
}
