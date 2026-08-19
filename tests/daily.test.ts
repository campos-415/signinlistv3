import { describe, expect, it } from "vitest";
import { computeDailyTotals } from "@/lib/daily";

// The day report totals. What matters here is not the arithmetic — it is
// which numbers are allowed to touch which, because the report is what the
// owner reads to know what the business earned.
const emptyDay = {
  signins: [],
  boardings: [],
  packageUses: [],
  packagesSold: [],
  selectedDate: "2026-08-16",
};

describe("computeDailyTotals — tips", () => {
  // Counted in revenue, because the money lands in the business's own
  // deposit and the day's takings are wrong without it. Kept as its own
  // category so the payout stays separable, and kept out of chargedTotal,
  // which is what pick-ups actually billed.
  it("totals tips and keeps them out of what was charged", () => {
    const totals = computeDailyTotals({
      ...emptyDay,
      payments: [
        { phone: "a", amount: 50, tip: 10, paid_on: "2026-08-16" },
        { phone: "b", amount: 70, tip: 5, paid_on: "2026-08-16" },
        { phone: "c", amount: 30, paid_on: "2026-08-16" },
      ],
    } as never);

    expect(totals.tipsTotal).toBe(15);
    // Two of the three carried one. An untipped payment is not a tip of
    // zero — it should not dilute the count staff divide by.
    expect(totals.tipsCount).toBe(2);
    // In revenue at the business's instruction; never in chargedTotal,
    // because a tip is not a charge against anybody.
    expect(totals.revenueTotal).toBe(15);
    expect(totals.chargedTotal).toBe(0);
  });

  it("reports no tips rather than failing when the column is absent", () => {
    // A database that has not run tips-migration.sql returns rows with no
    // tip field at all, and the report still has to render.
    const totals = computeDailyTotals(emptyDay as never);
    expect(totals.tipsTotal).toBe(0);
    expect(totals.tipsCount).toBe(0);
  });

  it("names who tipped, biggest first, so the pool can be checked", () => {
    // A total alone cannot be reconciled against a Square payout, and staff
    // dividing a pool cannot confirm a tip was captured at all.
    const totals = computeDailyTotals({
      ...emptyDay,
      payments: [
        { phone: "(415) 555-0001", amount: 50, tip: 5, method: "card", paid_on: "2026-08-16" },
        { phone: "(415) 555-0002", amount: 70, tip: 20, method: "cash", paid_on: "2026-08-16" },
        { phone: "(415) 555-0003", amount: 30, paid_on: "2026-08-16" },
      ],
    } as never);

    expect(totals.tipsBy.map((t) => t.phone)).toEqual(["(415) 555-0002", "(415) 555-0001"]);
    expect(totals.tipsBy[0].tip).toBe(20);
    // The untipped payment is absent, not listed as zero.
    expect(totals.tipsBy).toHaveLength(2);
    // And the list still adds up to the headline figure.
    expect(totals.tipsBy.reduce((s, t) => s + t.tip, 0)).toBe(totals.tipsTotal);
  });

  it("attaches the household name so a tip is not just a number", () => {
    const totals = computeDailyTotals({
      ...emptyDay,
      payments: [{ phone: "(415) 555-0002", amount: 70, tip: 20, paid_on: "2026-08-16" }],
      owners: [{ phone: "(415) 555-0002", owner_name: "Rivera" }],
    } as never);
    expect(totals.tipsBy[0].name).toBe("Rivera");
  });

  it("counts tips in revenue, on a line of their own", () => {
    // The money lands in the business's own deposit, so the day's takings are
    // wrong without it. It keeps its own category so payout stays separable.
    const totals = computeDailyTotals({
      ...emptyDay,
      payments: [{ phone: "a", amount: 50, tip: 15, paid_on: "2026-08-16" }],
    } as never);
    const tips = totals.revenue.find((c) => c.key === "tips");
    expect(tips?.amount).toBe(15);
    expect(tips?.count).toBe(1);
    expect(totals.revenueTotal).toBe(15);
    expect(totals.tipsTotal).toBe(15);
  });

  it("ignores a payment carrying no tip at all", () => {
    const totals = computeDailyTotals({
      ...emptyDay,
      payments: [{ phone: "a", amount: 50, paid_on: "2026-08-16" }],
    } as never);
    expect(totals.tipsTotal).toBe(0);
  });
});
