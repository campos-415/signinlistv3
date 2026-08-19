import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings";

// eligiblePackagesFor reads the business-wide duration out of settings, so
// the ON case can only be exercised with those settings replaced. Its own
// file because vi.mock applies per module graph.
vi.mock("@/lib/settings", async () => {
  const real = await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings");
  return {
    ...real,
    getSettings: () => ({
      ...real.DEFAULT_SETTINGS,
      pricing: { ...real.DEFAULT_SETTINGS.pricing, packageExpiryMonths: 6 },
    }),
  };
});

const { eligiblePackagesFor } = await import("@/lib/dogs");
import { Package } from "@/types";

const pkg = (created_at: string, over: Partial<Package> = {}): Package =>
  ({
    phone: "(415) 555-0000",
    client_name: "Test",
    total_days: 10,
    days_used: 3,
    created_at,
    ...over,
  }) as Package;

describe("eligiblePackagesFor — with a six month expiry in force", () => {
  it("will not offer an expired block for a visit to draw from", () => {
    // The point of the feature. A hard expiry that still let a visit draw
    // from the package would be an expiry in name only, and the difference
    // lands on the client's bill.
    const live = pkg(new Date().toISOString(), { id: "live", dog_name: "Koda" });
    const dead = pkg("2020-01-01T12:00:00Z", { id: "dead", dog_name: "Koda" });

    const out = eligiblePackagesFor([live, dead], "(415) 555-0000", "Koda");
    expect(out.map((p) => p.id)).toEqual(["live"]);
  });

  it("offers a block a manager has extended past the duration", () => {
    // The escape hatch has to actually reach the visit, or extending is
    // theatre: the row would look right and checkout would still charge.
    const extended = pkg("2020-01-01T12:00:00Z", {
      id: "extended",
      dog_name: "Koda",
      expires_on: "2099-01-01",
    });
    const out = eligiblePackagesFor([extended], "(415) 555-0000", "Koda");
    expect(out.map((p) => p.id)).toEqual(["extended"]);
  });

  it("also drops a shared household block once it expires", () => {
    // Shared packages carry no dog_name and are the easy one to forget.
    const shared = pkg("2020-01-01T12:00:00Z", { id: "shared" });
    expect(eligiblePackagesFor([shared], "(415) 555-0000", "Koda")).toEqual([]);
  });
});
