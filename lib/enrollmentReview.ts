// What a reviewer would find if they read the whole submission carefully.
//
// Approving an enrollment creates real dogs with real profiles, and the
// things that should stop it — an unsigned contract, a dog with no
// vaccination record — sit at opposite ends of a form long enough that
// nobody reads all of it every time. Twenty-odd rows per dog is where a
// missing rabies date goes to hide.
//
// So the reading is done once, here, and the answer is put at the top of the
// review. Blockers are reasons not to approve; warnings are things to know
// about before the dog turns up. Nothing here prevents an approval — staff
// often have the paperwork in hand — it just stops the form being the only
// place the problem is written down.
//
// Every check carries a stage. A stage-one submission has no vet and no
// emergency contact on it because it was never asked for them, and reporting
// that as a gap would put a permanent amber warning on every new enrollment
// — which is how a checklist stops being read.

import type { DogDraft, EnrollmentDraft } from "@/lib/enrollment";
import { EnrollmentStage, VACCINES } from "@/types";

export type CheckLevel = "blocker" | "warning";

export interface ReviewCheck {
  level: CheckLevel;
  /** Which dog it concerns, or "" for the household. */
  scope: string;
  label: string;
}

export interface ReviewSummary {
  checks: ReviewCheck[];
  blockers: number;
  warnings: number;
}

export function reviewChecks(
  draft: (EnrollmentDraft & { signature?: string }) | null | undefined,
  today: string,
  // Which half of the questionnaire this submission holds. Defaults to a
  // complete one, which is what every row written before two-stage
  // enrollment is.
  stage: EnrollmentStage = 2
): ReviewSummary {
  const checks: ReviewCheck[] = [];
  const add = (level: CheckLevel, scope: string, label: string) =>
    checks.push({ level, scope, label });

  if (!draft || !draft.owner) {
    add("blocker", "", "No owner details were saved with this submission");
    return summarise(checks);
  }

  const o = draft.owner;
  if (!o.phone?.trim()) add("blocker", "", "No phone number");
  if (!o.email?.trim()) add("warning", "", "No email address — no confirmation can be sent");
  // Asked at stage two, so at stage one their absence is the normal state
  // of an enrollment that has got this far, not something to chase.
  if (stage === 2) {
    if (!o.emergency_name?.trim() && !o.emergency_phone?.trim())
      add("warning", "", "No emergency contact");
    if (!o.vet_name?.trim()) add("warning", "", "No veterinarian on file");
  }

  if (!draft.contractAgreed) add("blocker", "", "Contract not accepted");
  if (!draft.policyAgreed) add("blocker", "", "Meet & greet policy not accepted");
  if (!draft.signature) add("blocker", "", "Not signed");

  const dogs = draft.dogs ?? [];
  if (dogs.length === 0) add("blocker", "", "No dogs on the form");

  for (const dog of dogs) {
    const name = dog.dog_name?.trim() || "Unnamed dog";
    if (!dog.dog_name?.trim()) add("blocker", name, "No name given");
    for (const check of dogChecks(dog, today)) add(check.level, name, check.label);
  }

  return summarise(checks);
}

// No stage argument: everything a dog is checked for here — vaccination
// dates, the uploaded record, the behaviour flags — is asked at stage one or
// fires only on a yes. See the note above the behaviour block.
function dogChecks(dog: DogDraft, today: string): { level: CheckLevel; label: string }[] {
  const out: { level: CheckLevel; label: string }[] = [];

  const missing = VACCINES.filter((v) => !dog.vaccines?.[v.key]?.expires_on);
  // Expiry is checked as well as presence: a date typed in from a certificate
  // that ran out last spring reads as complete on the form and is not.
  const expired = VACCINES.filter((v) => {
    const on = dog.vaccines?.[v.key]?.expires_on;
    return !!on && on < today;
  });

  if (missing.length === VACCINES.length) out.push({ level: "blocker", label: "No vaccination dates at all" });
  else if (missing.length > 0)
    out.push({ level: "warning", label: `No date for ${missing.map((v) => v.label).join(", ")}` });
  if (expired.length > 0)
    out.push({
      level: "blocker",
      label: `Expired: ${expired.map((v) => v.label).join(", ")}`,
    });
  if (!dog.doc) out.push({ level: "blocker", label: "No vaccination record uploaded" });

  // Behaviour the front desk needs to know on day one. Warnings, never
  // blockers — an honest answer about a dog that has growled is a reason to
  // handle it carefully, not to turn it away.
  //
  // No stage guard needed below: every one of these fires on a yes, and at
  // stage one the answers are all still unanswered. What the stage does
  // change is the meaning of their silence, which is why the review screen
  // says out loud that these were not asked yet.
  if (dog.bitten) out.push({ level: "warning", label: "Has bitten" });
  if (dog.growled) out.push({ level: "warning", label: "Has growled" });
  if (dog.dog_fight) out.push({ level: "warning", label: "Has been in a dog fight" });
  if (dog.climbed_fence) out.push({ level: "warning", label: "Climbs fences" });
  if (dog.health_problems) out.push({ level: "warning", label: "Has health problems" });
  if (dog.allergies?.length) out.push({ level: "warning", label: `Allergies: ${dog.allergies.join(", ")}` });
  if (dog.fixed === false) out.push({ level: "warning", label: "Not spayed or neutered" });

  return out;
}

function summarise(checks: ReviewCheck[]): ReviewSummary {
  // Blockers first — a reviewer scanning the top of the list should hit the
  // reasons to stop before the things that are merely worth knowing.
  const ordered = [...checks].sort((a, b) =>
    a.level === b.level ? 0 : a.level === "blocker" ? -1 : 1
  );
  return {
    checks: ordered,
    blockers: checks.filter((c) => c.level === "blocker").length,
    warnings: checks.filter((c) => c.level === "warning").length,
  };
}
