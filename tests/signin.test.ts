import { describe, expect, it } from "vitest";
import { buildOpenVisits, packageApplies, walkPackageApplies } from "@/lib/signin";
import { Package } from "@/types";
import { SignInRecord } from "@/types";

// Who is actually in the building.
//
// Everything downstream leans on this: the In House list, the day report, the
// kiosk deciding whether to offer drop-off or pick-up, and what a sign-out
// charges. It is a state machine over a flat log of taps, so the interesting
// cases are the ones a real front desk produces — the same dog in and out
// twice in a day, a tap recorded against a clock that is wrong.

const NOW = new Date("2026-08-17T15:00:00.000Z");

const row = (
  dogId: string,
  action: "drop_off" | "pick_up",
  iso: string,
  extra: Partial<SignInRecord> = {}
): Partial<SignInRecord> => ({
  dog_id: dogId,
  action,
  created_at: iso,
  service_type: "daycare",
  ...extra,
});

describe("buildOpenVisits", () => {
  it("counts a dog dropped off and not collected as in", () => {
    const open = buildOpenVisits([row("d1", "drop_off", "2026-08-17T08:00:00.000Z")], NOW);
    expect(open.has("d1")).toBe(true);
  });

  it("closes the visit once it is collected", () => {
    const open = buildOpenVisits(
      [
        row("d1", "drop_off", "2026-08-17T08:00:00.000Z"),
        row("d1", "pick_up", "2026-08-17T14:00:00.000Z"),
      ],
      NOW
    );
    expect(open.has("d1")).toBe(false);
  });

  it("reopens on a second drop-off after a pick-up", () => {
    // A dog collected at lunch and brought back at two is in the building.
    const open = buildOpenVisits(
      [
        row("d1", "drop_off", "2026-08-17T08:00:00.000Z"),
        row("d1", "pick_up", "2026-08-17T12:00:00.000Z"),
        row("d1", "drop_off", "2026-08-17T14:00:00.000Z"),
      ],
      NOW
    );
    expect(open.has("d1")).toBe(true);
    expect(open.get("d1")?.dropOffTime.toISOString()).toBe("2026-08-17T14:00:00.000Z");
  });

  it("ignores a drop-off timestamped in the future", () => {
    // The comment in the source calls this unrecoverable, and it is: a
    // future drop-off is later than every pick-up, so the visit can never be
    // closed and every sign-out prices the stay again.
    const open = buildOpenVisits(
      [row("d1", "drop_off", "2026-08-18T08:00:00.000Z")], // tomorrow
      NOW
    );
    expect(open.has("d1")).toBe(false);
  });

  it("still accepts a tap a few seconds ahead, for clock skew between devices", () => {
    const skewed = new Date(NOW.getTime() + 30_000).toISOString();
    const open = buildOpenVisits([row("d1", "drop_off", skewed)], NOW);
    expect(open.has("d1")).toBe(true);
  });

  it("ignores rows with no dog on them", () => {
    // Older rows recorded a name and no id. They cannot be attributed to a
    // dog, and guessing would put the wrong dog in the building.
    const open = buildOpenVisits(
      [{ action: "drop_off", created_at: "2026-08-17T08:00:00.000Z" }],
      NOW
    );
    expect(open.size).toBe(0);
  });

  it("keeps dogs separate", () => {
    const open = buildOpenVisits(
      [
        row("d1", "drop_off", "2026-08-17T08:00:00.000Z"),
        row("d2", "drop_off", "2026-08-17T08:05:00.000Z"),
        row("d1", "pick_up", "2026-08-17T13:00:00.000Z"),
      ],
      NOW
    );
    expect(open.has("d1")).toBe(false);
    expect(open.has("d2")).toBe(true);
  });

  it("carries the service and add-ons from the drop-off, so the sign-out prices what was agreed", () => {
    const open = buildOpenVisits(
      [
        row("d1", "drop_off", "2026-08-17T08:00:00.000Z", {
          service_type: "boarding",
          addons: ["bath"],
          bath_size: "M",
        }),
      ],
      NOW
    );
    expect(open.get("d1")?.serviceType).toBe("boarding");
    expect(open.get("d1")?.addons).toEqual(["bath"]);
    expect(open.get("d1")?.bathSize).toBe("M");
  });
});

describe("saying no to a package", () => {
  // Staff can refuse a package on a visit. Both refusals are stored on the
  // drop-off row, and both have been ignored at some point in a way that cost
  // a client days they had paid for:
  //
  //   - package_opt_out was written and then left out of the column list
  //     loadPhoneContext selects, so checkout read undefined and spent the day
  //     while the screen showed the refusal sticking.
  //   - walk_opt_out did not exist at all, so "No walk used" could be chosen,
  //     would not survive a reload, and the walk was spent regardless.
  //
  // These pin the rule itself; the column lists are pinned by the fallback in
  // loadPhoneContext.
  const pkg = (over: Partial<Package> = {}): Package =>
    ({ id: "p1", phone: "(555) 000-0001", total_days: 10, days_used: 0, ...over }) as Package;

  const visitWith = (extra: Partial<SignInRecord>) =>
    buildOpenVisits(
      [row("d1", "drop_off", "2026-08-17T08:00:00.000Z", { addons: ["walk"], ...extra })],
      NOW
    ).get("d1");

  it("spends a walk when nobody has said otherwise", () => {
    expect(walkPackageApplies(visitWith({}), pkg())).toBe(true);
  });

  it("does not spend a walk when staff said no", () => {
    expect(walkPackageApplies(visitWith({ walk_opt_out: true }), pkg())).toBe(false);
  });

  it("never covers a boarding walk, on the preview or the receipt", () => {
    // Boarding walks bill per walk on the reservation, so a block absorbing
    // them would charge the client twice for the same walks.
    //
    // The rule lived only in performSignIn, so the kiosk preview did not have
    // it: a stay was quoted with the walk at zero and then billed for it —
    // $200 on screen, $230 taken. Both now ask this one function.
    const boarding = buildOpenVisits(
      [row("d1", "drop_off", "2026-08-17T08:00:00.000Z", {
        addons: ["walk"],
        service_type: "boarding",
      })],
      NOW
    ).get("d1");
    expect(walkPackageApplies(boarding, pkg())).toBe(false);
  });

  it("still needs the walk add-on to be on the visit at all", () => {
    const noWalk = buildOpenVisits(
      [row("d1", "drop_off", "2026-08-17T08:00:00.000Z", { addons: [] })],
      NOW
    ).get("d1");
    expect(walkPackageApplies(noWalk, pkg())).toBe(false);
  });

  it("does not spend a day when staff said no, even on a full day", () => {
    // Eight hours in — the automatic rule would take a day.
    const full = visitWith({ package_opt_out: true });
    expect(packageApplies("daycare", full, pkg(), NOW)).toBe(false);
    // Unless somebody picks that block by hand, which outranks everything.
    expect(packageApplies("daycare", full, pkg(), NOW, true)).toBe(true);
  });

  it("the two refusals are independent", () => {
    const noDayOnly = visitWith({ package_opt_out: true });
    expect(packageApplies("daycare", noDayOnly, pkg(), NOW)).toBe(false);
    // Refusing the day says nothing about the walk.
    expect(walkPackageApplies(noDayOnly, pkg())).toBe(true);
  });
});
