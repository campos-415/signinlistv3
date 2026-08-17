import { describe, expect, it } from "vitest";
import { contractClauses } from "@/components/EnrollmentForm";
import { DEFAULT_SETTINGS } from "@/lib/settings";

// The contract is the one piece of copy in this app with legal weight: it
// covers veterinary authorisation, liability for injury and abandonment. Two
// things have to hold — it says the right business's name, and editing it
// never changes what somebody already signed.
describe("contractClauses", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    business: { ...DEFAULT_SETTINGS.business, name: "Mountain View Dog Daycare" },
  };

  it("fills the business name in wherever it appears", () => {
    const clauses = contractClauses(settings);
    const all = clauses.map((c) => c.body).join(" ");
    expect(all).toContain("Mountain View Dog Daycare");
    // A leftover placeholder would go out to clients as literal braces.
    expect(all).not.toContain("{{business}}");
  });

  it("substitutes every occurrence, not just the first", () => {
    const clauses = contractClauses({
      ...settings,
      forms: {
        ...settings.forms,
        contractClauses: [
          { heading: "Twice", body: "{{business}} and again {{business}}." },
        ],
      },
    });
    expect(clauses[0].body).toBe(
      "Mountain View Dog Daycare and again Mountain View Dog Daycare."
    );
  });

  it("returns nothing to render when a business has removed every clause", () => {
    // Legitimate: a daycare using its own paper contract. It must not
    // resurrect the shipped terms — see the merge rule in lib/settings.ts.
    const clauses = contractClauses({
      ...settings,
      forms: { ...settings.forms, contractClauses: [] },
    });
    expect(clauses).toEqual([]);
  });

  it("leaves the stored copy on a submission untouched by later edits", () => {
    // What EnrollmentDraft.contractText exists for. The rendered clauses are
    // a snapshot; changing settings afterwards produces different output, and
    // the snapshot taken earlier must not follow it.
    const signed = contractClauses(settings);
    const afterEdit = contractClauses({
      ...settings,
      forms: {
        ...settings.forms,
        contractClauses: [{ heading: "Replaced", body: "Everything is different now." }],
      },
    });
    expect(signed[0].heading).not.toBe(afterEdit[0].heading);
    expect(signed.length).toBeGreaterThan(1);
  });
});
