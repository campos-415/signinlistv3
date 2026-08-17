"use client";

import Link from "next/link";
import { ChangeEvent, forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import BusyButton from "@/components/BusyButton";
import SignaturePad, { SignaturePadHandle } from "@/components/SignaturePad";
import DateField from "@/components/DateField";
import { Field, YesNo, inputClass } from "@/components/FormBits";
import { PdfWorkerMissingError, fileToRecordJpeg } from "@/lib/image";
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
  DOG_SEXES,
  DogSex,
  MEET_GREET_HOURS,
  MEET_GREET_WINDOWS,
  VACCINES,
  isMeetGreetDay,
} from "@/types";

// Stage one of the enrollment: the public form on /enroll, the lobby form on
// /signup, and the copy embedded in the boarding request.
//
// It asks only what is needed to decide on a meet & greet and hold it
// safely — who the household is, the dog basics, vaccinations with the
// record, the agreements and the signature. The address, the vet, and the
// behaviour and health questions come later, through the details form linked
// from the email sent when the meet & greet passes. See lib/enrollment.ts.
//
// A vaccination record is usually a photo of a page or a PDF from the vet.
// Photos get resized like every other image in the app; PDFs are stored as
// they are, so this is the ceiling on what a submission can weigh.

export interface EnrollmentPrefill {
  owner_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  /** One dog card is seeded per name. */
  dogNames?: string[];
  /**
   * The dogs themselves, when the host form has already described them.
   *
   * Takes precedence over `dogNames` — a host passing these has asked for the
   * breed, birthday and the rest already, and pairs it with `lockDogBasics` so
   * this form does not ask again. Kept live rather than seeded once, so
   * editing a dog in the host form updates the submission this one sends.
   */
  dogs?: DogDraft[];
}

export interface EnrollmentFormHandle {
  /** Validates and sends. Resolves true only when it was filed. */
  submit: () => Promise<boolean>;
}

function EnrollmentFormInner({
  source,
  embed = false,
  prefill,
  lockContact = false,
  lockDogBasics = false,
  hideSubmit = false,
  onDogNamesChange,
  onSubmitted,
  detailsOnFile = false,
}: {
  // Where the submission came from, so staff reviewing the queue know
  // whether someone stood at the front desk or filled it in at home.
  source: "kiosk" | "web";
  // Drops the logo, heading and navigation, for embedding in an iframe on
  // the business's own website where that chrome is already on the page.
  embed?: boolean;
  // Details the person has already typed somewhere else — the booking form
  // asks for the same name, phone and dogs, and asking twice on one page is
  // how a form gets abandoned.
  prefill?: EnrollmentPrefill;
  // Hides the four contact fields the host form already collected, and keeps
  // them following whatever the host has. Only meaningful with `prefill`.
  lockContact?: boolean;
  // Hides the dog's name, breed, colour, birthday, weight, gender and fixed
  // status, and keeps them following `prefill.dogs`. For a host form that has
  // already asked who the dog is — what is left here is the vaccination
  // record, the meet & greet and the agreements.
  lockDogBasics?: boolean;
  // Hides this form's own submit. The host drives it through the ref
  // instead, so one button sends both forms.
  hideSubmit?: boolean;
  // Reports the dog names as they are typed, so a host form that also needs
  // them does not have to ask a second time.
  onDogNamesChange?: (names: string[]) => void;
  // Lets a host page react to a successful submission and keep its own
  // chrome, instead of this form taking over with its confirmation screen.
  onSubmitted?: () => void;
  // The household has already answered stage two — an existing client
  // adding another dog. Files the submission complete, so nothing later
  // asks them to finish an enrollment that is finished.
  detailsOnFile?: boolean;
}, ref: React.Ref<EnrollmentFormHandle>) {
  const { settings } = useSettings();
  // Whether there is a client sign-in to promise on the way out. Off until a
  // business turns it on, so the thank-you screen must not describe one.
  const portalOn = settings.portal.enabled;
  // The kiosk sends people back to the sign-in screen; the website sends
  // them back to the website.
  const homeHref = source === "kiosk" ? "/kiosk" : "/";
  // The contract as this business words it, with {{business}} filled in.
  const clauses = contractClauses(settings);
  const [draft, setDraft] = useState<EnrollmentDraft>(() => {
    const base = emptyEnrollment();
    if (!prefill) return base;
    const names = (prefill.dogNames ?? []).map((n) => n.trim()).filter(Boolean);
    return {
      ...base,
      owner: {
        ...base.owner,
        owner_name: prefill.owner_name ?? base.owner.owner_name,
        last_name: prefill.last_name ?? base.owner.last_name,
        phone: prefill.phone ?? base.owner.phone,
        email: prefill.email ?? base.owner.email,
      },
      // One card per dog already named, so the questionnaire is the only
      // thing left to fill in. Fully described dogs win over bare names.
      dogs: prefill.dogs?.length
        ? prefill.dogs
        : names.length
          ? names.map((n) => ({ ...emptyDog(), dog_name: n }))
          : base.dogs,
    };
  });
  const lockedName = prefill?.owner_name ?? "";
  const lockedLast = prefill?.last_name ?? "";
  const lockedPhone = prefill?.phone ?? "";
  const lockedEmail = prefill?.email ?? "";
  useEffect(() => {
    if (!lockContact) return;
    setDraft((d) => ({
      ...d,
      owner: {
        ...d.owner,
        owner_name: lockedName,
        last_name: lockedLast,
        phone: lockedPhone,
        email: lockedEmail,
      },
    }));
  }, [lockContact, lockedName, lockedLast, lockedPhone, lockedEmail]);

  // The same trick for the dogs, when the host form owns them.
  //
  // Only the fields the host asked for are taken. The vaccination record, the
  // meet & greet and the agreements are answered *here*, and copying the whole
  // dog across would wipe them on every keystroke in the host form.
  const lockedDogsKey = JSON.stringify(prefill?.dogs ?? null);
  useEffect(() => {
    if (!lockDogBasics) return;
    const incoming: DogDraft[] = prefill?.dogs ?? [];
    setDraft((d) => ({
      ...d,
      dogs: incoming.map((dog, i) => ({
        ...(d.dogs[i] ?? emptyDog()),
        dog_name: dog.dog_name,
        breed: dog.breed,
        color: dog.color,
        birthdate: dog.birthdate,
        weight_lb: dog.weight_lb,
        sex: dog.sex,
        fixed: dog.fixed,
        fixed_scheduled_on: dog.fixed_scheduled_on,
      })),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockDogBasics, lockedDogsKey]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const sigRef = useRef<SignaturePadHandle>(null);

  useImperativeHandle(ref, () => ({ submit: handleSubmit }));

  // Mirror the dog names outward whenever they change.
  const dogNamesKey = draft.dogs.map((d) => d.dog_name).join("\u0000");
  useEffect(() => {
    onDogNamesChange?.(draft.dogs.map((d) => d.dog_name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dogNamesKey]);

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

  async function handleDoc(index: number, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    try {
      // Image or PDF, in or out, it lands as one budgeted JPEG. A PDF used to
      // be stored byte for byte, so a scanned certificate could be megabytes
      // in a database row; now its pages are rendered and stacked.
      const data = await fileToRecordJpeg(file);
      setDog(index, { doc: { name: file.name, mime: "image/jpeg", data } });
    } catch (err) {
      console.error("Reading vaccination record failed:", err);
      // A missing pdf.js worker is a fault at our end, and telling somebody
      // their certificate is unreadable when it is not sends them off to
      // re-scan a perfectly good document.
      setError(
        err instanceof PdfWorkerMissingError
          ? `${err.message} A photo of the certificate works in the meantime.`
          : "Could not read that file — try a photo or a PDF."
      );
    }
  }

  async function handleSubmit(): Promise<boolean> {
    const problem = validateEnrollment(draft);
    if (problem) {
      setError(problem);
      return false;
    }
    if (sigRef.current?.isEmpty()) {
      setError("Please sign at the bottom of the form.");
      return false;
    }
    setError("");
    setSubmitting(true);
    try {
      // The contract as it read at the moment of signing, stored with the
      // submission. Editing it in Settings later must not change what this
      // household appears to have agreed to.
      await submitForApproval(
        { ...draft, contractText: clauses },
        sigRef.current?.toDataURL() ?? "",
        source,
        detailsOnFile
      );
      // Confirmation email. Awaited so a slow send doesn't race the
      // unmount, but never fatal — the form is already filed, and saying
      // otherwise because an email bounced would be wrong.
      await sendAcknowledgement(draft);
      await notifyStaffOfEnrollment(draft);
      setDone(true);
      onSubmitted?.();
      return true;
    } catch (e) {
      console.error("Enrollment submit failed:", e);
      setError("Couldn't send that — check your connection and try again.");
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  // Same fix as the booking form, and only when this form owns the page.
  useEffect(() => {
    if (done && !hideSubmit) window.scrollTo(0, 0);
  }, [done, hideSubmit]);

  if (done && !hideSubmit) {
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
        {/* Only said when there is an account to be had.

            This promised an emailed invitation and a place to see visits and
            what is owed. Client accounts are switched off until a business
            turns them on, so on most deployments that was a promise nobody
            was going to keep — and a client who has been told to expect an
            email waits for it, then rings the front desk about it.

            An existing client adding another dog is told none of it either:
            they already have an account and answered those questions the
            first time. */}
        {portalOn &&
          (detailsOnFile ? (
            <p className="text-sm text-ink-3">
              Nothing else to fill in — we already have your address, your vet and your emergency
              contact from last time. This will show up in your account once we have approved it.
            </p>
          ) : (
            <>
              <p className="text-sm text-ink-3">
                Once the meet &amp; greet has gone well we&apos;ll email you a link to set up your
                account.
              </p>
              <p className="text-xs text-ink-3">
                That account is also where you&apos;ll find{" "}
                {draft.dogs.length > 1 ? "their" : "your dog's"} vaccination dates, your visits and
                what you owe.
              </p>
            </>
          ))}
        {!embed && (
          <Link
            href="/"
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

      {/* Said before the first question rather than after the last one: the
          reason this form is short is worth knowing while deciding whether to
          start it.
          Not when embedded: the host form has already explained why this is
          here, and "just enough to book your meet & greet" is the wrong
          promise on a page where somebody is booking a stay. */}
      {!embed && (
        <p className="mb-5 rounded-2xl border border-line-soft bg-surface-2 px-4 py-3 text-xs leading-relaxed text-ink-2">
          {settings.forms.enrollIntro}
        </p>
      )}

      {/* Contract */}
      <Section title="Contract" step={1} bare={embed}>
        <div className="max-h-52 overflow-y-auto rounded-xl border border-line bg-surface-2 p-4 text-xs leading-relaxed text-ink-2">
          <ContractText clauses={clauses} />
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

      {/* Owner
          Gone entirely when the host form asked for these. It used to echo the
          name and phone back under a heading of their own, a few inches below
          the fields they were typed into — a whole section whose content was
          "yes, we still have what you just wrote". The values are still sent;
          there is simply nothing worth showing. */}
      {!lockContact && (
      <Section title="Owner information" step={2}>
        <div className="grid gap-3 sm:grid-cols-2">
          <>
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
            </>
        </div>
      </Section>
      )}

      {/* Dogs */}
      {draft.dogs.map((dog, i) => (
        <Section
          key={i}
          step={3 + i}
          bare={embed}
          title={
            multi
              ? `Dog ${i + 1}${dog.dog_name ? ` — ${dog.dog_name}` : ""}`
              : // With the basics asked elsewhere, what is left under this
                // heading is paperwork, so the heading says so.
                lockDogBasics
                ? `${dog.dog_name.trim() || "Your dog"} — vaccinations`
                : "Your dog"
          }
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
            onDoc={handleDoc}
            hideBasics={lockDogBasics}
          />
        </Section>
      ))}

      {/* Hidden when the host form owns the list. Two "add another dog"
          buttons on one page, only one of which adds a dog to the booking,
          is a way to end up with a stay booked for fewer dogs than enrolled. */}
      {!lockDogBasics && (
        <button
          type="button"
          onClick={() => setDraft((d) => ({ ...d, dogs: [...d.dogs, emptyDog()] }))}
          className="mb-5 w-full rounded-2xl border border-dashed border-line bg-surface px-4 py-3 text-sm font-medium text-ink-3 transition hover:border-accent-400 hover:text-accent-600"
        >
          + Add another dog
        </button>
      )}

      {/* Meet & greet + signature */}
      <Section
        title="Meet &amp; greet and signature"
        step={3 + draft.dogs.length}
        bare={embed}
      >
        <div className="rounded-xl border border-line bg-surface-2 p-4 text-xs leading-relaxed text-ink-2">
          {settings.forms.meetGreetPolicy}
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

      {!hideSubmit && (
      <div className="flex flex-wrap items-center gap-3">
        {/* The enrollment carries a photo, a signature and a vaccination
            record, so this is the slowest submit in the app and the one most
            likely to be pressed twice. */}
        <BusyButton busy={submitting} busyLabel="Sending your enrollment…" onClick={handleSubmit}>
          Submit for review
        </BusyButton>
        <p className="text-xs text-ink-3">
          We&apos;ll review it and confirm by email — you can&apos;t check in until then.
        </p>
        {!embed && (
          <Link href={homeHref} className="ml-auto text-xs font-medium text-ink-3 hover:text-ink-2">
            Back
          </Link>
        )}
      </div>
      )}
    </div>
  );
}

/**
 * Who the dog is: the fields any profile needs before it can exist.
 *
 * Exported because the boarding request form asks for them too. A household
 * booking a stay for a dog we have never met needs enrolling, and the natural
 * place to describe the dog is beside the dates it is coming — not in a second
 * form further down the page that opens with an empty name field.
 *
 * One component rather than two copies, so a field added here cannot go
 * missing there.
 */
export function DogBasics({
  dog,
  onChange,
  hideName = false,
}: {
  dog: DogDraft;
  onChange: (patch: Partial<DogDraft>) => void;
  /** For a host that asked for the name further up its own page. */
  hideName?: boolean;
}) {
  const age = ageFromBirthdate(dog.birthdate);

  // The column count follows how many fields are on screen.
  //
  // Five (with the name) sit as a row of three and a row of two; four (the
  // boarding form asks the name itself) sit as two rows of two. The wrong
  // choice either way leaves a single field alone on the last row beside two
  // empty columns, which reads as a rendering fault rather than a layout —
  // and that is what happens with a column count fixed at three.
  //
  // A trailing gap at the END of a last row is fine. A lone field is not.
  const columns = hideName ? "sm:grid-cols-2" : "sm:grid-cols-3";

  return (
    <>
      <div className={`grid gap-3 ${columns}`}>
        {!hideName && (
          <Field label="Dog's name" required>
            <input
              value={dog.dog_name}
              onChange={(e) => onChange({ dog_name: e.target.value })}
              className={inputClass}
            />
          </Field>
        )}
        <Field label="Breed" required>
          <input
            value={dog.breed}
            onChange={(e) => onChange({ breed: e.target.value })}
            placeholder="Mixed breed"
            className={inputClass}
          />
        </Field>
        {/* No colour here. It is asked on the details form after the meet &
            greet, where a field that identifies nothing costs nobody a
            booking — see stageTwoDogPatch. */}
        {/* Age isn't stored — it's derived from the birthday, so it can't go
            stale the way a typed-in number does. */}
        <Field label="Birthday" required hint={age ? `About ${age} old` : undefined}>
          <DateField
            value={dog.birthdate}
            onChange={(v) => onChange({ birthdate: v })}
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
            onChange={(e) => onChange({ weight_lb: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Gender" required>
          <select
            value={dog.sex}
            onChange={(e) => onChange({ sex: e.target.value as DogSex | "" })}
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

      {/* On its own row, and deliberately outside the grid above.
          It is a pair of buttons rather than a text input, so it does not
          belong in a column beside one — and keeping it out is what lets the
          grid divide evenly whatever is hidden. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Spayed / neutered?" required>
          <YesNo value={dog.fixed} onChange={(v) => onChange({ fixed: v })} />
        </Field>
        {dog.fixed === false && (
          <Field label="If no, when is it scheduled?">
            <DateField
              value={dog.fixed_scheduled_on}
              onChange={(v) => onChange({ fixed_scheduled_on: v })}
              className={inputClass}
              ariaLabel="Spay or neuter appointment"
            />
          </Field>
        )}
      </div>
    </>
  );
}

function DogSection({
  dog,
  index,
  setDog,
  onDoc,
  hideBasics = false,
}: {
  dog: DogDraft;
  index: number;
  setDog: (i: number, patch: Partial<DogDraft>) => void;
  onDoc: (i: number, e: ChangeEvent<HTMLInputElement>) => void;
  hideBasics?: boolean;
}) {
  return (
    <div className="space-y-5">
      {/* Skipped when the host form has already asked for them — the boarding
          request collects the dog's details beside its dates, so meeting them
          again here would be the same questions twice on one page. The values
          still travel with the submission; only the inputs are absent. */}
      {!hideBasics && (
        <DogBasics dog={dog} onChange={(patch) => setDog(index, patch)} />
      )}

      {/* No date fields here any more.
          Owners were typing five expiry dates off a certificate they were
          uploading anyway, and staff checked every one against that document
          before approving — so the typing produced a number nobody trusted,
          and mistyped ones cost the front desk more time than they saved.
          The document is the record. Staff read the dates off it on the dog
          profile, where it is on screen beside the fields. */}
      <SubHeading>Vaccinations</SubHeading>
      <p className="text-xs text-ink-3">
        Upload a photo or PDF of your dog&apos;s vaccination records. We will read the dates off it
        — you do not need to type them in.
      </p>
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

      {/* The owner saying it in as many words. The document proves it and
          staff will read it, but a dog cannot be on site without these three
          and this is the line the household is answering for. */}
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3">
        <input
          type="checkbox"
          checked={dog.vaccinesConfirmed}
          onChange={(e) => setDog(index, { vaccinesConfirmed: e.target.checked })}
          className="mt-0.5 h-4 w-4 shrink-0 accent-accent-500"
        />
        <span className="text-xs leading-relaxed text-ink-2">
          I confirm {dog.dog_name.trim() || "my dog"} is up to date on{" "}
          <span className="font-medium text-ink">
            {REQUIRED_VACCINES.map((key) => VACCINES.find((v) => v.key === key)?.label ?? key).join(
              ", "
            )}
          </span>
          , and that the records above are current.
          <span className="ml-0.5 text-rose-500">*</span>
        </span>
      </label>

      <SubHeading>Your visit</SubHeading>
      <div className="grid gap-3 sm:grid-cols-2">
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
  bare = false,
  children,
}: {
  title: string;
  step: number;
  action?: React.ReactNode;
  /**
   * Drops the number and the card, for a form living inside another one.
   *
   * The boarding request numbers its own steps 1 to 4, and this form numbered
   * its own 1 to 4 as well — so a household enrolling while they booked met
   * two step 3s on one page, one of them nested inside the other. A guest has
   * no business keeping its own numbering.
   */
  bare?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={
        bare
          ? "mb-5"
          : "mb-5 rounded-3xl bg-surface p-5 shadow-card sm:p-6"
      }
    >
      <div className="mb-4 flex items-center gap-2.5">
        {!bare && (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-500 text-[11px] font-semibold text-accent-ink">
            {step}
          </span>
        )}
        <h2
          className={
            bare
              ? "text-[11px] font-semibold uppercase tracking-wide text-ink-3"
              : "font-display text-base font-semibold text-ink"
          }
        >
          {title}
        </h2>
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
/**
 * The contract, as the business words it.
 *
 * The clauses used to live here as a hardcoded array with the business name
 * dropped in. They are a legal agreement between a daycare and its clients —
 * veterinary authorisation, liability for injury, abandonment — so an insurer
 * or a lawyer wanting a change should not mean a code change and a redeploy.
 * They are in Settings now; this only renders them.
 */
export function contractClauses(settings: {
  forms: { contractClauses: { heading: string; body: string }[] };
  business: { name: string };
}): { heading: string; body: string }[] {
  return settings.forms.contractClauses.map((c) => ({
    heading: c.heading,
    // Substituted rather than stored, so renaming the business updates its
    // own terms instead of leaving the old name in them.
    body: c.body.replace(/\{\{business\}\}/g, settings.business.name),
  }));
}

function ContractText({ clauses }: { clauses: { heading: string; body: string }[] }) {
  if (!clauses.length) {
    return (
      <p className="text-ink-3">
        No contract has been set up. Add one under Settings &rarr; Content.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {clauses.map(({ heading, body }) => (
        <div key={heading}>
          <p className="font-semibold text-ink-2">{heading}</p>
          <p>{body}</p>
        </div>
      ))}
    </div>
  );
}

const EnrollmentForm = forwardRef(EnrollmentFormInner);
export default EnrollmentForm;
