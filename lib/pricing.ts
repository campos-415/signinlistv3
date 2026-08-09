// -----------------------------------------------------------------------
// Walk-in pricing. Covers daycare/boarding base rate, walk/nail-trim
// (fixed the moment picked at drop-off), and bath (priced by size,
// assigned on /records — can happen any time, even mid-visit, and once
// set it's included here too). Returns a structured breakdown so the UI
// can show a line-by-line total, not just one number.
// -----------------------------------------------------------------------

export const PRICING = {
  daycareFullDay: 70,
  daycareHalfDay: 50, // 4 hours or less
  daycareHalfDayThresholdHours: 4,
  boardingPerNight: 90,
  latePickupHour: 12, // pick-up at or after noon on a boarding stay adds a half-day daycare fee
  latePickupFee: 50,
} as const;

// Fixed add-on prices, applied automatically once selected at drop-off.
export const ADDON_PRICES: Record<"walk" | "nail_trim", number> = {
  walk: 30,
  nail_trim: 25,
};

// Bath has no fixed price — size (and price) is assigned on /records.
export const BATH_PRICES: Record<"S" | "M" | "L", number> = {
  S: 60,
  M: 80,
  L: 100,
};

// Boarding add-on pricing. Walk is per walk (so a stay with 2 walks/day
// over 3 nights charges 6 walks); medication is a flat daily fee for
// the whole stay; nail trim is a flat one-time fee for the stay.
export const BOARDING_ADDON_PRICES = {
  walkPerWalk: 25,
  medicationPerDay: 10,
  nailTrim: 25,
} as const;

export interface BoardingAddonInput {
  addons: string[];
  walksPerDay?: number | null;
  bathSize?: "S" | "M" | "L" | null;
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
  isFinalPickUp: boolean = true
): PriceEstimate | null {
  const breakdown: PriceBreakdownItem[] = [];

  if (!baseCovered) {
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
        breakdown.push({ label: "Daycare fee (late pick-up)", amount: PRICING.latePickupFee });
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
