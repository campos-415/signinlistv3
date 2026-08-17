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

describe("computeDailyTotals — tips are held, not earned", () => {
  // A tip arrives on the business's card reader and belongs to whoever
  // worked that day. Counting it as revenue overstates income to the
  // accountant and hides what is owed to staff, so it is totalled and kept
  // out of every other figure.
  it("totals tips without adding them to revenue or charges", () => {
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
    expect(totals.revenueTotal).toBe(0);
    expect(totals.chargedTotal).toBe(0);
  });

  it("reports no tips rather than failing when the column is absent", () => {
    // A database that has not run tips-migration.sql returns rows with no
    // tip field at all, and the report still has to render.
    const totals = computeDailyTotals(emptyDay as never);
    expect(totals.tipsTotal).toBe(0);
    expect(totals.tipsCount).toBe(0);
  });

  it("ignores a payment carrying no tip at all", () => {
    const totals = computeDailyTotals({
      ...emptyDay,
      payments: [{ phone: "a", amount: 50, paid_on: "2026-08-16" }],
    } as never);
    expect(totals.tipsTotal).toBe(0);
  });
});
