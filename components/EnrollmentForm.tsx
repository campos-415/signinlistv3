"use client";

import Link from "next/link";
import { ChangeEvent, useRef, useState } from "react";
import SignaturePad, { SignaturePadHandle } from "@/components/SignaturePad";
import DateField from "@/components/DateField";
import { CheckGrid, ChoiceWithOther, Field, YesNo, YesNoDetail, inputClass } from "@/components/FormBits";
import { fileToResizedDataUrl } from "@/lib/image";
import { formatPhoneInput } from "@/lib/phone";
import { useSettings } from "@/components/SettingsProvider";
import {
  DogDraft,
  EnrollmentDraft,
  REQUIRED_VACCINES,
  ageFromBirthdate,
  emptyDog,
  emptyEnrollment,
  notifyStaffOfEnrollment,
  sendAcknowledgement,
  submitForApproval,
  validateEnrollment,
} from "@/lib/enrollment";
import {
  ACTIVITY_RESTRICTIONS,
  ALLERGENS,
  ATTENDANCE_PLANS,
  BEHAVIOR_TRAITS,
  BIG_DOG_RESPONSES,
  DOG_SEXES,
  DogSex,
  FLEA_PROGRAMS,
  HEARD_ABOUT,
  MEET_GREET_HOURS,
  MEET_GREET_WINDOWS,
  PACKAGE_INTEREST,
  PLAY_STYLES,
  VACCINES,
  VaccineKey,
  isMeetGreetDay,
} from "@/types";

// A vaccination record is usually a photo of a page or a PDF from the vet.
// Photos get resized like every other image in the app; PDFs are stored as
// they are, so this is the ceiling on what a submission can weigh.
const MAX_DOC_BYTES = 4 * 1024 * 1024;

export default function EnrollmentForm({
  source,
  embed = false,
}: {
  // Where the submission came from, so staff reviewing the queue know
  // whether someone stood at the front desk or filled it in at home.
  source: "kiosk" | "web";
  // Drops the logo, heading and navigation, for embedding in an iframe on
  // the business's own website where that chrome is already on the page.
  embed?: boolean;
}) {
  const { settings } = useSettings();
  // The kiosk sends people back to the sign-in screen; the website sends
  // them back to the website.
  const homeHref = source === "kiosk" ? "/kiosk" : "/";
  const [draft, setDraft] = useState<EnrollmentDraft>(emptyEnrollment());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const sigRef = useRef<SignaturePadHandle>(null);

  function setOwner<K extends keyof EnrollmentDraft["owner"]>(
    key: K,
    value: EnrollmentDraft["owner"][K]
  ) {
    setDraft((d) => ({ ...d, owner: { ...d.owner, [key]: value } }));
  }

  function setDog(index: number, patch: Partial<DogDraft>) {
    setDraft((d) => ({
      ...d,
      dogs: d.dogs.map((dog, i) => (i === index ? { ...dog, ...patch } : dog)),
    }));
  }

  function setVaccine(index: number, key: VaccineKey, patch: Partial<{ given_on: string; expires_on: string }>) {
    setDraft((d) => ({
      ...d,
      dogs: d.dogs.map((dog, i) =>
        i === index
          ? { ...dog, vaccines: { ...dog.vaccines, [key]: { ...dog.vaccines[key], ...patch } } }
          : dog
      ),
    }));
  }

  async function handleDoc(index: number, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    try {
      if (file.type.startsWith("image/")) {
        // 1200px keeps small print on a vet's printout legible, which 640
        // (the size used for dog portraits) does not.
        const data = await fileToResizedDataUrl(file, 1200, 0.8);
        setDog(index, { doc: { name: file.name, mime: "image/jpeg", data } });
        return;
      }
      if (file.size > MAX_DOC_BYTES) {
        setError("That file is over 4 MB — please upload a photo of the record instead.");
        return;
      }
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      setDog(index, { doc: { name: file.name, mime: file.type || "application/octet-stream", data } });
    } catch (err) {
      console.error("Reading vaccination record failed:", err);
      setError("Could not read that file — try a photo or a PDF.");
    }
  }

  async function handleSubmit() {
    const problem = validateEnrollment(draft);
    if (problem) {
      setError(problem);
      return;
    }
    if (sigRef.current?.isEmpty()) {
      setError("Please sign at the bottom of the form.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await submitForApproval(draft, sigRef.current?.toDataURL() ?? "", source);
      // Confirmation email. Awaited so a slow send doesn't race the
      // unmount, but never fatal — the form is already filed, and saying
      // otherwise because an email bounced would be wrong.
      await sendAcknowledgement(draft);
      await notifyStaffOfEnrollment(draft);
      setDone(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      console.error("Enrollment submit failed:", e);
      setError("Couldn't send that — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-20 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-accent-500 text-3xl text-accent-ink shadow-card">
          ✓
        </div>
        <p className="text-lg font-medium text-ink">
          Thanks — we&apos;ve got it.
        </p>
        <p className="text-sm text-ink-3">
          {settings.business.name} will review{" "}
          {draft.dogs.length > 1 ? "these profiles" : "the profile"} and be in
          touch to confirm your meet &amp; greet. You&apos;ll be able to check
          in by phone number once it&apos;s approved.
        </p>
        {!embed && (
          <Link
            href="/https://dog-daycare-website-two.vercel.app"
            className="mt-2 rounded-xl bg-accent-500 px-6 py-2.5 text-sm font-medium text-accent-ink shadow-card transition hover:bg-accent-600">
            Back to the start
          </Link>
        )}
      </div>
    );
  }

  const multi = draft.dogs.length > 1;

  return (
    <div className={`mx-auto max-w-3xl ${embed ? "px-4 py-6" : "px-5 py-10 sm:px-8"}`}>
      {!embed && (
        <div className="mb-8 text-center">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            New client enrollment
          </h1>
          <p className="mt-1 text-sm text-ink-3">
            {settings.business.name} — one form per household, however many dogs
          </p>
        </div>
      )}

      {/* Contract */}
      <Section title="Contract" step={1}>
        <div className="max-h-52 overflow-y-auto rounded-xl border border-line bg-surface-2 p-4 text-xs leading-relaxed text-ink-2">
          <ContractText business={settings.business.name} />
        </div>
        <label className="mt-3 flex items-start gap-2">
          <input
            type="checkbox"
            checked={draft.contractAgreed}
            onChange={(e) => setDraft({ ...draft, contractAgreed: e.target.checked })}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-accent-500 focus:ring-accent-100"
          />
          <span className="text-sm text-ink-2">
            I have read and agree to every section of the contract above.
            <span className="ml-0.5 text-rose-500">*</span>
          </span>
        </label>
      </Section>

      {/* Owner */}
      <Section title="Owner information" step={2}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name" required>
            <input
              value={draft.owner.owner_name}
              onChange={(e) => setOwner("owner_name", e.target.value)}
              autoComplete="given-name"
              className={inputClass}
            />
          </Field>
          <Field label="Last name" required>
            <input
              value={draft.owner.last_name}
              onChange={(e) => setOwner("last_name", e.target.value)}
              autoComplete="family-name"
              className={inputClass}
            />
          </Field>
          <Field label="Phone number" required hint="This is what you'll use to check in.">
            <input
              value={draft.owner.phone}
              onChange={(e) => setOwner("phone", formatPhoneInput(e.target.value))}
              placeholder="(123) 456-7890"
              inputMode="tel"
              autoComplete="tel"
              className={inputClass}
            />
          </Field>
          <Field label="Email" required>
            <input
              type="email"
              value={draft.owner.email}
              onChange={(e) => setOwner("email", e.target.value)}
              placeholder="name@example.com"
              autoComplete="email"
              className={inputClass}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Street address" required>
              <input
                value={draft.owner.address}
                onChange={(e) => setOwner("address", e.target.value)}
                autoComplete="street-address"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="City" required>
            <input
              value={draft.owner.city}
              onChange={(e) => setOwner("city", e.target.value)}
              autoComplete="address-level2"
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="State" required>
              <input
                value={draft.owner.state}
                onChange={(e) => setOwner("state", e.target.value.toUpperCase())}
                maxLength={2}
                autoComplete="address-level1"
                className={inputClass}
              />
            </Field>
            <Field label="ZIP" required>
              <input
                value={draft.owner.zip}
                onChange={(e) => setOwner("zip", e.target.value)}
                inputMode="numeric"
                autoComplete="postal-code"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Emergency contact name" required>
            <input
              value={draft.owner.emergency_name}
              onChange={(e) => setOwner("emergency_name", e.target.value)}
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Emergency phone" required>
              <input
                value={draft.owner.emergency_phone}
                onChange={(e) => setOwner("emergency_phone", formatPhoneInput(e.target.value))}
                inputMode="tel"
                className={inputClass}
              />
            </Field>
            <Field label="Relationship">
              <input
                value={draft.owner.emergency_relation}
                onChange={(e) => setOwner("emergency_relation", e.target.value)}
                placeholder="Sister, neighbour…"
                className={inputClass}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field
              label="Others authorized to pick up your dog"
              required
              hint="Nobody else will be allowed to collect your dog. Enter “nobody” if it's only you."
            >
              <input
                value={draft.owner.authorized_pickup}
                onChange={(e) => setOwner("authorized_pickup", e.target.value)}
                placeholder="Names of anyone else allowed"
                className={inputClass}
              />
            </Field>
          </div>
        </div>
      </Section>

      {/* Vet */}
      <Section title="Veterinarian" step={3}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Hospital name">
            <input
              value={draft.owner.vet_name}
              onChange={(e) => setOwner("vet_name", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Phone number">
            <input
              value={draft.owner.vet_phone}
              onChange={(e) => setOwner("vet_phone", formatPhoneInput(e.target.value))}
              inputMode="tel"
              className={inputClass}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address">
              <input
                value={draft.owner.vet_address}
                onChange={(e) => setOwner("vet_address", e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
        </div>
      </Section>

      {/* Dogs */}
      {draft.dogs.map((dog, i) => (
        <Section
          key={i}
          step={4 + i}
          title={multi ? `Dog ${i + 1}${dog.dog_name ? ` — ${dog.dog_name}` : ""}` : "Your dog"}
          action={
            multi ? (
              <button
                type="button"
                onClick={() =>
                  setDraft((d) => ({ ...d, dogs: d.dogs.filter((_, n) => n !== i) }))
                }
                className="text-xs font-medium text-rose-500 hover:text-rose-600"
              >
                Remove
              </button>
            ) : null
          }
        >
          <DogSection
            dog={dog}
            index={i}
            setDog={setDog}
            setVaccine={setVaccine}
            onDoc={handleDoc}
          />
        </Section>
      ))}

      <button
        type="button"
        onClick={() => setDraft((d) => ({ ...d, dogs: [...d.dogs, emptyDog()] }))}
        className="mb-5 w-full rounded-2xl border border-dashed border-line bg-surface px-4 py-3 text-sm font-medium text-ink-3 transition hover:border-accent-400 hover:text-accent-600"
      >
        + Add another dog
      </button>

      {/* Meet & greet + signature */}
      <Section title="Meet &amp; greet and signature" step={4 + draft.dogs.length}>
        <div className="rounded-xl border border-line bg-surface-2 p-4 text-xs leading-relaxed text-ink-2">
          Every new dog comes in for a meet &amp; greet before their first full day, so we can see
          how they settle in with the group. Bring your dog on a leash and allow about half an hour.
          Requested dates are confirmed by phone or email — nothing is booked until we reply.
        </div>
        <label className="mt-3 flex items-start gap-2">
          <input
            type="checkbox"
            checked={draft.policyAgreed}
            onChange={(e) => setDraft({ ...draft, policyAgreed: e.target.checked })}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-accent-500 focus:ring-accent-100"
          />
          <span className="text-sm text-ink-2">
            I understand the meet &amp; greet policy.<span className="ml-0.5 text-rose-500">*</span>
          </span>
        </label>

        <div className="mt-4">
          <Field label="How did you hear about us?">
            <ChoiceWithOther
              options={HEARD_ABOUT}
              value={draft.owner.heard_about}
              onChange={(v) => setOwner("heard_about", v)}
              ariaLabel="How did you hear about us"
            />
          </Field>
        </div>

        <div className="mt-4">
          <p className="mb-1.5 text-[11px] font-medium text-ink-3">
            Signature<span className="ml-0.5 text-rose-500">*</span>
          </p>
          <p className="mb-2 text-xs text-ink-3">
            Signing covers the contract, the meet &amp; greet policy, and{" "}
            {multi ? "every dog listed above" : "the dog listed above"}.
          </p>
          <SignaturePad ref={sigRef} />
          <button
            type="button"
            onClick={() => sigRef.current?.clear()}
            className="mt-2 text-xs font-medium text-ink-3 hover:text-ink-2"
          >
            Clear signature
          </button>
        </div>
      </Section>

      {error && (
        <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="rounded-xl bg-accent-500 px-6 py-3 text-sm font-medium text-accent-ink shadow-card transition hover:bg-accent-600 disabled:opacity-60"
        >
          {submitting ? "Sending…" : "Submit for review"}
        </button>
        <p className="text-xs text-ink-3">
          We&apos;ll review it and confirm by email — you can&apos;t check in until then.
        </p>
        {!embed && (
          <Link href={homeHref} className="ml-auto text-xs font-medium text-ink-3 hover:text-ink-2">
            Back
          </Link>
        )}
      </div>
    </div>
  );
}

function DogSection({
  dog,
  index,
  setDog,
  setVaccine,
  onDoc,
}: {
  dog: DogDraft;
  index: number;
  setDog: (i: number, patch: Partial<DogDraft>) => void;
  setVaccine: (i: number, key: VaccineKey, patch: Partial<{ given_on: string; expires_on: string }>) => void;
  onDoc: (i: number, e: ChangeEvent<HTMLInputElement>) => void;
}) {
  const age = ageFromBirthdate(dog.birthdate);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Dog's name" required>
          <input
            value={dog.dog_name}
            onChange={(e) => setDog(index, { dog_name: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Breed" required>
          <input
            value={dog.breed}
            onChange={(e) => setDog(index, { breed: e.target.value })}
            placeholder="Mixed breed"
            className={inputClass}
          />
        </Field>
        <Field label="Colour" required>
          <input
            value={dog.color}
            onChange={(e) => setDog(index, { color: e.target.value })}
            className={inputClass}
          />
        </Field>
        {/* Age isn't stored — it's derived from the birthday, so it can't go
            stale the way a typed-in number does. */}
        <Field label="Birthday" required hint={age ? `About ${age} old` : undefined}>
          <DateField
            value={dog.birthdate}
            onChange={(v) => setDog(index, { birthdate: v })}
            className={inputClass}
            ariaLabel="Birthday"
          />
        </Field>
        <Field label="Weight (lb)" required>
          <input
            type="number"
            min="0"
            step="0.1"
            value={dog.weight_lb}
            onChange={(e) => setDog(index, { weight_lb: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Gender" required>
          <select
            value={dog.sex}
            onChange={(e) => setDog(index, { sex: e.target.value as DogSex | "" })}
            className={inputClass}
          >
            <option value="">Choose…</option>
            {DOG_SEXES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Spayed / neutered?" required>
          <YesNo value={dog.fixed} onChange={(v) => setDog(index, { fixed: v })} />
        </Field>
        {dog.fixed === false && (
          <Field label="If no, when is it scheduled?">
            <DateField
              value={dog.fixed_scheduled_on}
              onChange={(v) => setDog(index, { fixed_scheduled_on: v })}
              className={inputClass}
              ariaLabel="Spay or neuter appointment"
            />
          </Field>
        )}
        <Field label="Flea program">
          <ChoiceWithOther
            options={FLEA_PROGRAMS}
            value={dog.flea_program}
            onChange={(v) => setDog(index, { flea_program: v })}
            ariaLabel="Flea program"
          />
        </Field>
        <Field label="Where did you get your dog?">
          <input
            value={dog.dog_source}
            onChange={(e) => setDog(index, { dog_source: e.target.value })}
            placeholder="Breeder, shelter, rescue…"
            className={inputClass}
          />
        </Field>
      </div>

      <SubHeading>History</SubHeading>
      <div className="grid gap-3 sm:grid-cols-2">
        <YesNoDetail
          required
          label="Has your dog ever growled at a person or another dog?"
          value={dog.growled}
          onChange={(v) => setDog(index, { growled: v })}
          detail={dog.growled_note}
          onDetailChange={(v) => setDog(index, { growled_note: v })}
          detailLabel="What happened?"
        />
        <YesNoDetail
          required
          label="Has your dog ever bitten a person or another dog?"
          value={dog.bitten}
          onChange={(v) => setDog(index, { bitten: v })}
          detail={dog.bitten_note}
          onDetailChange={(v) => setDog(index, { bitten_note: v })}
          detailLabel="What happened?"
        />
        <YesNoDetail
          required
          label="Has your dog ever climbed or jumped a fence?"
          value={dog.climbed_fence}
          onChange={(v) => setDog(index, { climbed_fence: v })}
          detail={dog.fence_height}
          onDetailChange={(v) => setDog(index, { fence_height: v })}
          detailLabel="How high was it?"
          detailPlaceholder="e.g. 5 ft"
        />
        <YesNoDetail
          required
          label="Has your dog ever been in a fight with another dog?"
          value={dog.dog_fight}
          onChange={(v) => setDog(index, { dog_fight: v })}
          detail={dog.dog_fight_note}
          onDetailChange={(v) => setDog(index, { dog_fight_note: v })}
          detailLabel="What happened?"
        />
      </div>

      <SubHeading>Health &amp; grooming</SubHeading>
      <div className="space-y-3">
        <YesNoDetail
          required
          label="Does your dog have any health problems?"
          value={dog.health_problems}
          onChange={(v) => setDog(index, { health_problems: v })}
          detail={dog.health_notes}
          onDetailChange={(v) => setDog(index, { health_notes: v })}
          detailLabel="Please describe"
        />
        <Field label="Any activity restrictions?">
          <CheckGrid
            options={ACTIVITY_RESTRICTIONS}
            value={dog.activity_restrictions}
            onChange={(v) => setDog(index, { activity_restrictions: v })}
            otherPlaceholder="Other restrictions, comma separated"
          />
        </Field>
        <Field label="Any allergies?" hint="Leave blank if none.">
          <CheckGrid
            options={ALLERGENS}
            value={dog.allergies}
            onChange={(v) => setDog(index, { allergies: v })}
            otherPlaceholder="Other allergies, comma separated"
          />
        </Field>
        <YesNoDetail
          required
          label="Is your dog sensitive about being touched anywhere?"
          value={dog.sensitive_areas}
          onChange={(v) => setDog(index, { sensitive_areas: v })}
          detail={dog.sensitive_areas_note}
          onDetailChange={(v) => setDog(index, { sensitive_areas_note: v })}
          detailLabel="Where?"
          detailPlaceholder="Paws, ears, tail…"
        />
      </div>

      <SubHeading>Behaviour</SubHeading>
      <div className="space-y-3">
        <Field label="Which of these describe your dog?" required>
          <CheckGrid
            options={BEHAVIOR_TRAITS}
            value={dog.behavior_traits}
            onChange={(v) => setDog(index, { behavior_traits: v })}
            otherPlaceholder="Anything else, comma separated"
          />
        </Field>
        <Field label="What is your dog like at play?" required>
          <CheckGrid
            options={PLAY_STYLES}
            value={dog.play_style}
            onChange={(v) => setDog(index, { play_style: v })}
            otherPlaceholder="Anything else, comma separated"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="How often do you expect to visit?" required>
            <ChoiceWithOther
              options={ATTENDANCE_PLANS}
              value={dog.attendance_plan}
              onChange={(v) => setDog(index, { attendance_plan: v })}
              ariaLabel="Expected visit frequency"
            />
          </Field>
          <Field label="How is your dog around big dogs?" required>
            <ChoiceWithOther
              options={BIG_DOG_RESPONSES}
              value={dog.big_dog_response}
              onChange={(v) => setDog(index, { big_dog_response: v })}
              ariaLabel="Around big dogs"
            />
          </Field>
          <Field label="Crate trained?" required>
            <YesNo value={dog.crate_trained} onChange={(v) => setDog(index, { crate_trained: v })} />
          </Field>
          <Field label="Kennel trained?" required>
            <YesNo value={dog.kennel_trained} onChange={(v) => setDog(index, { kennel_trained: v })} />
          </Field>
        </div>
      </div>

      <SubHeading>Vaccinations</SubHeading>
      <p className="text-xs text-ink-3">
        Enter the expiry date from your dog&apos;s records for each vaccine, and upload a photo or
        PDF of the paperwork. Rabies, DHPP and Bordetella are required.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[26rem] text-left text-sm">
          <thead>
            <tr className="border-b border-line-soft text-[11px] font-medium uppercase tracking-wide text-ink-3">
              <th className="py-2 pr-3">Vaccine</th>
              <th className="py-2 pr-3">Date given</th>
              <th className="py-2">Expires</th>
            </tr>
          </thead>
          <tbody>
            {VACCINES.map((v) => (
              <tr key={v.key} className="border-b border-line-soft last:border-0">
                <td className="py-2 pr-3 font-medium text-ink-2">
                  {v.label}
                  {REQUIRED_VACCINES.includes(v.key) && <span className="ml-0.5 text-rose-500">*</span>}
                </td>
                <td className="py-2 pr-3">
                  <DateField
                    value={dog.vaccines[v.key]?.given_on ?? ""}
                    onChange={(val) => setVaccine(index, v.key, { given_on: val })}
                    wrapperClassName="w-40"
                    className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent-500"
                    ariaLabel={`${v.label} date given`}
                  />
                </td>
                <td className="py-2">
                  <DateField
                    value={dog.vaccines[v.key]?.expires_on ?? ""}
                    onChange={(val) => setVaccine(index, v.key, { expires_on: val })}
                    wrapperClassName="w-40"
                    className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent-500"
                    ariaLabel={`${v.label} expiry`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Field label="Vaccination records" required>
        <div className="flex flex-wrap items-center gap-3">
          <label className="cursor-pointer rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink-2 transition hover:border-accent-400">
            {dog.doc ? "Replace file" : "Choose a photo or PDF"}
            <input
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => onDoc(index, e)}
            />
          </label>
          {dog.doc && (
            <span className="flex items-center gap-2 text-xs text-ink-2">
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">
                ✓ {dog.doc.name}
              </span>
              <button
                type="button"
                onClick={() => setDog(index, { doc: null })}
                className="text-rose-400 hover:text-rose-600"
              >
                remove
              </button>
            </span>
          )}
        </div>
      </Field>

      <SubHeading>Before you finish</SubHeading>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Interested in a daycare package?">
          <ChoiceWithOther
            options={PACKAGE_INTEREST}
            value={dog.package_interest}
            onChange={(v) => setDog(index, { package_interest: v })}
            ariaLabel="Interested in a package"
          />
        </Field>
        <Field
          label="Preferred meet & greet date"
          hint={`${MEET_GREET_HOURS}. We'll confirm before it's booked.`}
        >
          <DateField
            value={dog.meet_greet_on}
            onChange={(v) => setDog(index, { meet_greet_on: v })}
            className={inputClass}
            ariaLabel="Meet and greet date"
          />
        </Field>
      </div>

      {/* Caught here as well as in validation, so a weekend date is
          obvious the moment it's typed rather than on submit. */}
      {dog.meet_greet_on && !isMeetGreetDay(dog.meet_greet_on) && (
        <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          We only do meet &amp; greets {MEET_GREET_HOURS.toLowerCase()} — please pick a weekday.
        </p>
      )}

      {dog.meet_greet_on && isMeetGreetDay(dog.meet_greet_on) && (
        <Field label="Which arrival window suits you?" required>
          <div className="flex flex-wrap gap-2">
            {MEET_GREET_WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setDog(index, { meet_greet_window: w })}
                className={`rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
                  dog.meet_greet_window === w
                    ? "border-accent-500 bg-accent-500 text-accent-ink shadow-card"
                    : "border-line bg-surface text-ink-2 hover:border-accent-300"
                }`}
              >
                {w}
              </button>
            ))}
          </div>
        </Field>
      )}
    </div>
  );
}

function Section({
  title,
  step,
  action,
  children,
}: {
  title: string;
  step: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 rounded-3xl bg-surface p-5 shadow-card sm:p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-500 text-[11px] font-semibold text-accent-ink">
          {step}
        </span>
        <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </section>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="border-t border-line-soft pt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
      {children}
    </h3>
  );
}

// Kept in the component tree rather than a settings field: it's the same
// standard set of terms for any facility running this app, and the business
// name is the only part that changes per deployment.
function ContractText({ business }: { business: string }) {
  const clauses: [string, string][] = [
    [
      "Health and vaccinations",
      `My dog is in good health, has not been ill with a communicable condition in the last 30 days, and is currently vaccinated against rabies, distemper/parvo (DHPP) and bordetella. I will keep those records current with ${business} and understand my dog may be turned away if they lapse.`,
    ],
    [
      "Temperament",
      `My dog has not shown aggression toward people or other dogs beyond anything I have disclosed on this form. ${business} may refuse or end a stay if my dog is unsafe around others, and will contact me to collect them.`,
    ],
    [
      "Risk of injury",
      "I understand that dogs play off-leash in groups, and that scratches, nicks and scrapes can happen even with careful supervision. I accept that ordinary risk.",
    ],
    [
      "Veterinary care",
      `If my dog needs medical attention and I cannot be reached, I authorize ${business} to obtain veterinary care at my expense, preferring my own vet where practical.`,
    ],
    [
      "Payment and pick-up",
      "I will pay all charges when my dog is collected, and I will collect my dog by closing time. Late collection may incur a fee, and dogs left without contact for an extended period may be treated as abandoned.",
    ],
    [
      "Photos",
      `I agree that ${business} may photograph my dog for its records and social media, without payment.`,
    ],
  ];
  return (
    <div className="space-y-3">
      {clauses.map(([heading, body]) => (
        <div key={heading}>
          <p className="font-semibold text-ink-2">{heading}</p>
          <p>{body}</p>
        </div>
      ))}
    </div>
  );
}
