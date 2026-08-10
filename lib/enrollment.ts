// The new-client enrollment questionnaire: its draft shape, its validation,
// and the writes it makes.
//
// Submitting does NOT create a client. The whole thing lands in
// `enrollments` as a pending row for staff to review on /requests —
// anyone on the internet can reach the public form, and a stranger's
// submission shouldn't be a bookable dog until someone has looked at it.
// Approving is what fans the answers out into `owners`, `clients`,
// `vaccinations` and `dog_docs`.

import { getSupabase } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { renderTemplate, sendEmail } from "@/lib/email";
import { notifyStaff } from "@/lib/notify";
import {
  Dog,
  DogSex,
  MEET_GREET_HOURS,
  Enrollment,
  FixedStatus,
  Owner,
  VACCINES,
  VaccineKey,
  isMeetGreetDay,
} from "@/types";

// Vaccines a dog can't be enrolled without. The other entries in VACCINES
// are collected but optional — influenza and leptospirosis aren't given to
// every dog, and refusing the enrollment over them would just push clients
// into typing something false.
export const REQUIRED_VACCINES: VaccineKey[] = ["rabies", "dhpp", "bordetella"];

export interface VaccineDraft {
  given_on: string;
  expires_on: string;
}

export interface DogDraft {
  dog_name: string;
  breed: string;
  birthdate: string;
  weight_lb: string;
  color: string;
  sex: DogSex | "";
  fixed: boolean | null;
  fixed_scheduled_on: string;
  flea_program: string;
  dog_source: string;

  growled: boolean | null;
  growled_note: string;
  bitten: boolean | null;
  bitten_note: string;
  climbed_fence: boolean | null;
  fence_height: string;
  dog_fight: boolean | null;
  dog_fight_note: string;

  health_problems: boolean | null;
  health_notes: string;
  activity_restrictions: string[];
  allergies: string[];
  sensitive_areas: boolean | null;
  sensitive_areas_note: string;

  behavior_traits: string[];
  play_style: string[];
  attendance_plan: string;
  big_dog_response: string;
  crate_trained: boolean | null;
  kennel_trained: boolean | null;

  package_interest: string;
  meet_greet_on: string;
  meet_greet_window: string;

  vaccines: Record<VaccineKey, VaccineDraft>;
  // The uploaded vaccination paperwork, already converted to a data URL.
  doc: { name: string; mime: string; data: string } | null;
}

export interface OwnerDraft {
  owner_name: string;
  last_name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  emergency_name: string;
  emergency_phone: string;
  emergency_relation: string;
  authorized_pickup: string;
  vet_name: string;
  vet_phone: string;
  vet_address: string;
  heard_about: string;
}

export interface EnrollmentDraft {
  owner: OwnerDraft;
  dogs: DogDraft[];
  contractAgreed: boolean;
  policyAgreed: boolean;
}

function emptyVaccines(): Record<VaccineKey, VaccineDraft> {
  return Object.fromEntries(
    VACCINES.map((v) => [v.key, { given_on: "", expires_on: "" }])
  ) as Record<VaccineKey, VaccineDraft>;
}

export function emptyDog(): DogDraft {
  return {
    dog_name: "",
    breed: "",
    birthdate: "",
    weight_lb: "",
    color: "",
    sex: "",
    fixed: null,
    fixed_scheduled_on: "",
    flea_program: "",
    dog_source: "",
    growled: null,
    growled_note: "",
    bitten: null,
    bitten_note: "",
    climbed_fence: null,
    fence_height: "",
    dog_fight: null,
    dog_fight_note: "",
    health_problems: null,
    health_notes: "",
    activity_restrictions: [],
    allergies: [],
    sensitive_areas: null,
    sensitive_areas_note: "",
    behavior_traits: [],
    play_style: [],
    attendance_plan: "",
    big_dog_response: "",
    crate_trained: null,
    kennel_trained: null,
    package_interest: "",
    meet_greet_on: "",
    meet_greet_window: "",
    vaccines: emptyVaccines(),
    doc: null,
  };
}

export function emptyOwner(): OwnerDraft {
  return {
    owner_name: "",
    last_name: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    emergency_name: "",
    emergency_phone: "",
    emergency_relation: "",
    authorized_pickup: "",
    vet_name: "",
    vet_phone: "",
    vet_address: "",
    heard_about: "",
  };
}

export function emptyEnrollment(): EnrollmentDraft {
  return { owner: emptyOwner(), dogs: [emptyDog()], contractAgreed: false, policyAgreed: false };
}

// The form asks gender and "spayed/neutered?" separately, which is how an
// owner thinks about it; the app stores one field. Without a sex on file
// there's no way to pick the right word, so a fixed dog of unknown sex is
// recorded as "unknown" rather than guessed at.
export function toFixedStatus(sex: DogSex | "", fixed: boolean | null): FixedStatus | null {
  if (fixed === false) return "intact";
  if (fixed !== true) return null;
  if (sex === "female") return "spayed";
  if (sex === "male") return "neutered";
  return "unknown";
}

export function ageFromBirthdate(birthdate?: string | null): string {
  if (!birthdate) return "";
  const born = new Date(`${birthdate}T12:00:00`);
  if (Number.isNaN(born.getTime())) return "";
  const now = new Date();
  let months = (now.getFullYear() - born.getFullYear()) * 12 + (now.getMonth() - born.getMonth());
  if (now.getDate() < born.getDate()) months -= 1;
  if (months < 0) return "";
  if (months < 24) return `${months} month${months === 1 ? "" : "s"}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${years} yr ${rem} mo` : `${years} years`;
}

/** Returns a human-readable problem, or "" when the draft is submittable. */
export function validateEnrollment(draft: EnrollmentDraft): string {
  const o = draft.owner;
  if (!o.owner_name.trim()) return "Enter the owner's name.";
  if (!o.last_name.trim()) return "Enter the owner's last name.";
  if (o.phone.replace(/\D/g, "").length < 7) return "Enter a phone number.";
  if (!/^\S+@\S+\.\S+$/.test(o.email.trim())) return "Enter a valid email address.";
  if (!o.address.trim() || !o.city.trim() || !o.state.trim() || !o.zip.trim())
    return "Enter the full home address.";
  if (!o.emergency_name.trim() || !o.emergency_phone.trim())
    return "Enter an emergency contact name and phone number.";
  if (!o.authorized_pickup.trim())
    return "List who else may pick up — enter “nobody” if it's only you.";

  for (const [i, d] of draft.dogs.entries()) {
    const who = draft.dogs.length > 1 ? `Dog ${i + 1}: ` : "";
    if (!d.dog_name.trim()) return `${who}enter the dog's name.`;
    if (!d.breed.trim()) return `${who}enter the breed.`;
    if (!d.birthdate) return `${who}enter the birthday.`;
    if (!d.weight_lb.trim()) return `${who}enter the weight.`;
    if (!d.color.trim()) return `${who}enter the colour.`;
    if (!d.sex) return `${who}choose a gender.`;
    if (d.fixed === null) return `${who}answer whether the dog is spayed or neutered.`;
    if (d.growled === null) return `${who}answer the growling question.`;
    if (d.bitten === null) return `${who}answer the biting question.`;
    if (d.climbed_fence === null) return `${who}answer the fence question.`;
    if (d.dog_fight === null) return `${who}answer the dog-fight question.`;
    if (d.health_problems === null) return `${who}answer the health question.`;
    if (d.sensitive_areas === null) return `${who}answer the sensitive-areas question.`;
    if (!d.behavior_traits.length) return `${who}pick at least one behaviour trait.`;
    if (!d.play_style.length) return `${who}pick at least one thing about play style.`;
    if (!d.attendance_plan.trim()) return `${who}choose how often you expect to visit.`;
    if (!d.big_dog_response.trim()) return `${who}answer how the dog is with big dogs.`;
    if (d.crate_trained === null) return `${who}answer the crate-training question.`;
    if (d.kennel_trained === null) return `${who}answer the kennel-training question.`;

    // Meet & greets are weekday mornings only, so a Saturday date would
    // be a booking nobody can honour.
    if (d.meet_greet_on && !isMeetGreetDay(d.meet_greet_on))
      return `${who}meet & greets are ${MEET_GREET_HOURS.toLowerCase()} — pick a weekday.`;
    if (d.meet_greet_on && !d.meet_greet_window)
      return `${who}choose an arrival window for the meet & greet.`;

    for (const key of REQUIRED_VACCINES) {
      const label = VACCINES.find((v) => v.key === key)?.label ?? key;
      if (!d.vaccines[key]?.expires_on) return `${who}enter the ${label} expiry date.`;
    }
    if (!d.doc) return `${who}upload a copy of the vaccination records.`;
  }

  if (!draft.contractAgreed) return "Read and accept the contract to continue.";
  if (!draft.policyAgreed) return "Read and accept the meet & greet policy to continue.";
  return "";
}

const clean = (s: string) => s.trim() || null;

// Owner details, with blanks dropped. A household that already exists
// shouldn't have a field wiped just because this submission left it empty —
// only what was actually filled in gets written.
export function ownerPatch(o: OwnerDraft): Partial<Owner> {
  const patch: Record<string, string | null> = {
    owner_name: clean(`${o.owner_name.trim()}`),
    email: clean(o.email),
    address: clean(o.address),
    city: clean(o.city),
    state: clean(o.state),
    zip: clean(o.zip),
    emergency_name: clean(o.emergency_name),
    emergency_phone: clean(o.emergency_phone),
    emergency_relation: clean(o.emergency_relation),
    vet_name: clean(o.vet_name),
    vet_phone: clean(o.vet_phone),
    vet_address: clean(o.vet_address),
    heard_about: clean(o.heard_about),
  };
  for (const k of Object.keys(patch)) if (patch[k] === null) delete patch[k];
  return patch as Partial<Owner>;
}

export function dogPatch(d: DogDraft, o: OwnerDraft): Partial<Dog> {
  const weight = parseFloat(d.weight_lb);
  return {
    dog_name: d.dog_name.trim(),
    last_name: o.last_name.trim(),
    drop_off_by: o.owner_name.trim(),
    breed: clean(d.breed),
    birthdate: d.birthdate || null,
    weight_lb: Number.isFinite(weight) ? weight : null,
    color: clean(d.color),
    sex: d.sex || null,
    fixed_status: toFixedStatus(d.sex, d.fixed),
    // Only meaningful for a dog that isn't fixed yet; clearing it otherwise
    // stops a stale appointment hanging around after the surgery happens.
    fixed_scheduled_on: d.fixed === false ? d.fixed_scheduled_on || null : null,
    flea_program: clean(d.flea_program),
    dog_source: clean(d.dog_source),
    authorized_pickup: clean(o.authorized_pickup),
    growled: d.growled,
    growled_note: d.growled ? clean(d.growled_note) : null,
    bitten: d.bitten,
    bitten_note: d.bitten ? clean(d.bitten_note) : null,
    climbed_fence: d.climbed_fence,
    fence_height: d.climbed_fence ? clean(d.fence_height) : null,
    dog_fight: d.dog_fight,
    dog_fight_note: d.dog_fight ? clean(d.dog_fight_note) : null,
    health_problems: d.health_problems,
    health_notes: d.health_problems ? clean(d.health_notes) : null,
    activity_restrictions: d.activity_restrictions,
    allergies: d.allergies,
    sensitive_areas: d.sensitive_areas,
    sensitive_areas_note: d.sensitive_areas ? clean(d.sensitive_areas_note) : null,
    behavior_traits: d.behavior_traits,
    play_style: d.play_style,
    attendance_plan: clean(d.attendance_plan),
    big_dog_response: clean(d.big_dog_response),
    crate_trained: d.crate_trained,
    kennel_trained: d.kennel_trained,
    package_interest: clean(d.package_interest),
    meet_greet_on: d.meet_greet_on || null,
    meet_greet_window: d.meet_greet_on ? clean(d.meet_greet_window) : null,
  };
}

// Files the form to the review queue. Nothing else in the app can see the
// household yet — the kiosk still won't find them by phone.
export async function submitForApproval(
  draft: EnrollmentDraft,
  signature: string,
  source: "kiosk" | "web"
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("enrollments").insert({
    phone: draft.owner.phone.trim(),
    owner_name: draft.owner.owner_name.trim(),
    last_name: draft.owner.last_name.trim(),
    dog_names: draft.dogs.map((d) => d.dog_name.trim()),
    status: "pending",
    source,
    // The draft is stored whole rather than spread across columns: the
    // review page wants to show exactly what was submitted, and questions
    // will be added to the form over time without a migration each round.
    data: { ...draft, signature },
  });
  if (error) throw error;
}

// The placeholders every enrollment email template can use.
export function templateVars(draft: EnrollmentDraft): Record<string, string> {
  const names = draft.dogs.map((d) => d.dog_name.trim()).filter(Boolean);
  return {
    owner: draft.owner.owner_name.trim() || "there",
    dogs:
      names.length > 1
        ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
        : (names[0] ?? "your dog"),
    business: getSettings().business.name,
    phone: draft.owner.phone.trim(),
  };
}

// Fired straight after a submission. Deliberately never throws: the form
// has already been filed, and telling a client their enrollment failed
// because an email bounced would be a lie.
export async function sendAcknowledgement(draft: EnrollmentDraft): Promise<void> {
  const { email } = getSettings();
  if (!email.autoAcknowledge || !draft.owner.email.trim()) return;
  const vars = templateVars(draft);
  const result = await sendEmail({
    to: draft.owner.email.trim(),
    subject: renderTemplate(email.ackSubject, vars),
    body: renderTemplate(email.ackBody, vars),
  });
  if (result.error) console.error("Acknowledgement email failed:", result.error);
}

// Tells staff a form arrived. Separate from the client acknowledgement:
// that one is optional courtesy, this one is how anybody finds out.
export async function notifyStaffOfEnrollment(draft: EnrollmentDraft): Promise<void> {
  const names = draft.dogs.map((d) => d.dog_name.trim()).filter(Boolean);
  try {
    await notifyStaff({
      kind: "enrollment",
      who: `${draft.owner.owner_name.trim()} ${draft.owner.last_name.trim()}`.trim(),
      dogs: names.join(", ") || "—",
      detail: `${names.length} dog${names.length === 1 ? "" : "s"}`,
      phone: draft.owner.phone.trim(),
      email: draft.owner.email.trim(),
    });
  } catch (e) {
    console.error("Staff notification failed:", e);
  }
}

export async function loadPendingCount(): Promise<number> {
  try {
    const supabase = getSupabase();
    const { count, error } = await supabase
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    if (error) throw error;
    return count ?? 0;
  } catch (e) {
    // A missing table (migration not run yet) shouldn't break the nav.
    console.error("Counting pending enrollments failed:", e);
    return 0;
  }
}

export interface EnrollmentResult {
  created: string[];
  updated: string[];
}

// Turns an approved submission into real records. The signature covers
// every dog on it, the same way the paper contract does.
export async function applyEnrollment(
  draft: EnrollmentDraft,
  signature: string
): Promise<EnrollmentResult> {
  const supabase = getSupabase();
  const phone = draft.owner.phone.trim();
  const now = new Date().toISOString();

  const { error: ownerErr } = await supabase
    .from("owners")
    .upsert({ phone, ...ownerPatch(draft.owner) }, { onConflict: "phone" });
  if (ownerErr) throw ownerErr;

  // A household enrolling a second dog months later shouldn't end up with a
  // duplicate row for the dog they already have on file, so an existing
  // name on this number is updated in place instead.
  const { data: existingRows, error: existingErr } = await supabase
    .from("dogs")
    .select("id, dog_name")
    .eq("phone", phone);
  if (existingErr) throw existingErr;
  const existing = new Map(
    ((existingRows as { id: string; dog_name: string }[]) ?? []).map((c) => [
      c.dog_name.trim().toLowerCase(),
      c.id,
    ])
  );

  const result: EnrollmentResult = { created: [], updated: [] };

  for (const dog of draft.dogs) {
    const patch = {
      ...dogPatch(dog, draft.owner),
      phone,
      signature_data: signature,
      waiver_on_file: true,
      enrolled_at: now,
    };
    const priorId = existing.get(dog.dog_name.trim().toLowerCase());

    let dogId: string;
    if (priorId) {
      const { error } = await supabase.from("dogs").update(patch).eq("id", priorId);
      if (error) throw error;
      dogId = priorId;
      result.updated.push(dog.dog_name.trim());
    } else {
      const { data, error } = await supabase
        .from("dogs")
        .insert(patch)
        .select("id")
        .single();
      if (error) throw error;
      dogId = (data as { id: string }).id;
      result.created.push(dog.dog_name.trim());
    }

    const vaccineRows = VACCINES.map((v) => ({
      dog_id: dogId,
      vaccine: v.key,
      given_on: dog.vaccines[v.key]?.given_on || null,
      expires_on: dog.vaccines[v.key]?.expires_on || null,
    })).filter((r) => r.given_on || r.expires_on);
    if (vaccineRows.length) {
      const { error } = await supabase
        .from("vaccinations")
        .upsert(vaccineRows, { onConflict: "dog_id,vaccine" });
      if (error) throw error;
    }

    if (dog.doc) {
      const { error } = await supabase.from("dog_docs").insert({
        dog_id: dogId,
        kind: "vaccination",
        file_name: dog.doc.name,
        mime_type: dog.doc.mime,
        data: dog.doc.data,
      });
      // A failed upload shouldn't throw away an otherwise complete
      // enrollment — the dates are on file and staff can chase the paperwork.
      if (error) console.error("Saving vaccination document failed:", error);
    }
  }

  return result;
}

// Approve: create the records first, then mark the row. In that order a
// failure part-way leaves the submission still pending — visibly unfinished
// and re-runnable — rather than marked done with nothing behind it. The
// re-run is safe because applyEnrollment updates a dog it already created
// instead of duplicating it.
export async function approveEnrollment(row: Enrollment): Promise<EnrollmentResult> {
  const draft = row.data as EnrollmentDraft & { signature?: string };
  const result = await applyEnrollment(draft, draft.signature ?? "");
  const supabase = getSupabase();
  const { error } = await supabase
    .from("enrollments")
    .update({ status: "approved", reviewed_at: new Date().toISOString(), review_note: null })
    .eq("id", row.id);
  if (error) throw error;
  return result;
}

/**
 * Removes the submission itself.
 *
 * Only the request row goes. Anything approving it already created — the dog
 * profile, its vaccination records, the uploaded document — is real data with
 * a life of its own and stays put; deleting a form should not silently
 * un-enrol a dog that has been coming for months. Declining is the reversible
 * option, so this is for spam and duplicates.
 */
export async function deleteEnrollment(row: Enrollment): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("enrollments").delete().eq("id", row.id);
  if (error) throw error;
}

export async function rejectEnrollment(row: Enrollment, note: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("enrollments")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      review_note: note.trim() || null,
    })
    .eq("id", row.id);
  if (error) throw error;
}
