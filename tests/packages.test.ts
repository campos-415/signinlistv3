import { describe, expect, it } from "vitest";
import { daysUntilExpiry, packageExpired, packageExpiry } from "@/lib/packages";
import { Package } from "@/types";
import { eligiblePackagesFor } from "@/lib/dogs";

// Package expiry decides when somebody stops being able to use days they
// have already paid for, so the arithmetic is worth pinning precisely.
const pkg = (created_at: string, over: Partial<Package> = {}): Package =>
  ({
    phone: "(415) 555-0000",
    client_name: "Test",
    total_days: 10,
    days_used: 3,
    created_at,
    ...over,
  }) as Package;

describe("packageExpiry", () => {
  it("does not expire anything when the duration is off", () => {
    // The default, and the state every install starts in. Switching expiry on
    // is a deliberate act, never inherited.
    expect(packageExpiry(pkg("2020-01-01T12:00:00Z"), 0)).toBeNull();
    expect(packageExpired(pkg("2020-01-01T12:00:00Z"), 0)).toBe(false);
  });

  it("counts calendar months from the day of sale", () => {
    // What a client is told and what they will count: sold on the 15th,
    // expires on the 15th.
    expect(packageExpiry(pkg("2026-01-15T12:00:00Z"), 6)).toBe("2026-07-15");
  });

  it("pulls a short month back rather than overshooting into the next", () => {
    // 31 January plus one month is not 3 March. A client told "one month"
    // would never expect a date in the month after next.
    expect(packageExpiry(pkg("2026-01-31T12:00:00Z"), 1)).toBe("2026-02-28");
  });

  it("lets the package's own date win over the business-wide duration", () => {
    // The escape hatch: a manager extending one block for a family who were
    // away. It overrides in both directions.
    const extended = pkg("2026-01-15T12:00:00Z", { expires_on: "2027-01-01" });
    expect(packageExpiry(extended, 6)).toBe("2027-01-01");
    // And still applies when the duration is off entirely.
    expect(packageExpiry(extended, 0)).toBe("2027-01-01");
  });

  it("treats the expiry day itself as still usable", () => {
    const p = pkg("2026-01-15T12:00:00Z"); // expires 2026-07-15 at 6 months
    expect(packageExpired(p, 6, "2026-07-15")).toBe(false);
    expect(packageExpired(p, 6, "2026-07-16")).toBe(true);
  });

  it("counts the days left to use it", () => {
    const p = pkg("2026-01-15T12:00:00Z");
    expect(daysUntilExpiry(p, 6, "2026-07-10")).toBe(5);
    // Negative once it has gone, so a caller can tell "soon" from "already".
    expect(daysUntilExpiry(p, 6, "2026-07-20")).toBe(-5);
    expect(daysUntilExpiry(p, 0)).toBeNull();
  });

  it("expires blocks sold before the setting was turned on", () => {
    // Deliberate, and the reason the Settings screen counts the damage before
    // saving: the duration is backdated from the day of sale, so switching it
    // on can strand days somebody bought under no expiry at all.
    const old = pkg("2024-01-01T12:00:00Z");
    expect(packageExpired(old, 6, "2026-08-19")).toBe(true);
  });
});

describe("eligiblePackagesFor — an expired block is not offered", () => {
  // The point of the whole feature. A hard expiry that still let a visit
  // draw from the package would be an expiry in name only, and the money
  // difference lands on the client's bill.
  const live = pkg("2026-08-01T12:00:00Z", { id: "live", dog_name: "Koda" });
  const dead = pkg("2020-01-01T12:00:00Z", { id: "dead", dog_name: "Koda" });

  it("offers both while expiry is off", () => {
    const out = eligiblePackagesFor([live, dead], "(415) 555-0000", "Koda");
    expect(out.map((p) => p.id).sort()).toEqual(["dead", "live"]);
  });
});
