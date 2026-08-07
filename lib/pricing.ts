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
  bathSize: "S" | "M" | "L" | null = null
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
      if (pickUpTime.getHours() >= PRICING.latePickupHour) {
        breakdown.push({ label: "Dayacare fee", amount: PRICING.latePickupFee });
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
