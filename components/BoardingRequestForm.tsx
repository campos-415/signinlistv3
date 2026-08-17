"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import BusyButton from "@/components/BusyButton";
import DateField from "@/components/DateField";
import { Field, YesNo, inputClass } from "@/components/FormBits";
import { formatPhoneInput } from "@/lib/phone";
import { useSettings } from "@/components/SettingsProvider";
import EnrollmentForm, { DogBasics, EnrollmentFormHandle } from "@/components/EnrollmentForm";
import { DogDraft, emptyDog } from "@/lib/enrollment";
import { prettyDateKey } from "@/lib/dates";
import {
  BATH_PRICES,
  BOARDING_ADDON_PRICES,
  PRICING,
  estimateBoardingTotal,
} from "@/lib/pricing";
import {
  BoardingRequestDraft,
  BoardingRequestSource,
  MAX_WALKS_PER_DAY,
  NOTICE_DAYS,
  cleanDogNames,
  emptyBoardingRequest,
  isShortNotice,
  nightsFor,
  notifyStaffOfBoarding,
  noticeDays,
  sendBoardingAcknowledgement,
  submitBoardingRequest,
  validateBoardingRequest,
} from "@/lib/boardingRequest";
import { BOARDING_SERVICES, BoardingAddonKey } from "@/types";

/** Details the account already holds, so the form does not ask for them. */
export interface BoardingPrefill {
  owner_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
}

export default function BoardingRequestForm({
  source,
  embed = false,
  prefill,
  lockContact = false,
  knownDogs,
}: {
  source: BoardingRequestSource;
  // Drops the heading and back link, for embedding in an iframe on the
  // business's own website.
  embed?: boolean;
  // What the signed-in account already knows. The portal passes this; the
  // public form does not have it to pass.
  prefill?: BoardingPrefill;
  // Shows the contact details back rather than asking for them. Only
  // meaningful with `prefill`, and only honest when the details came from an
  // account rather than from something the person typed a moment ago.
  lockContact?: boolean;
  // The dogs on the account. Given these, the form offers them to tick
  // instead of asking somebody to type the name of a dog we already know —
  // which is also how a stay ends up filed under a spelling that matches no
  // profile. Passing this also settles the enrollment question: a dog with a
  // record here is enrolled by definition.
  knownDogs?: string[];
}) {
  const { settings } = useSettings();
  // The kiosk sends people back to the sign-in screen, the portal back to
  // the account, and the website back to the website.
  const homeHref = source === "kiosk" ? "/kiosk" : source === "portal" ? "/account" : "/";
  const [draft, setDraft] = useState<BoardingRequestDraft>(() => {
    const base = emptyBoardingRequest();
    if (!prefill) return base;
    return {
      ...base,
      owner_name: prefill.owner_name ?? base.owner_name,
      last_name: prefill.last_name ?? base.last_name,
      phone: prefill.phone ?? base.phone,
      email: prefill.email ?? base.email,
      // A household with dogs on file has answered this already.
      alreadyEnrolled: knownDogs?.length ? true : base.alreadyEnrolled,
      // One dog: ticked already, since there is nothing to choose between.
      // Several: none ticked, so nobody books the wrong dog by not looking.
      dogNames: knownDogs?.length ? (knownDogs.length === 1 ? [knownDogs[0]] : []) : base.dogNames,
    };
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  // Who each dog is, for a household that is not enrolled yet.
  //
  // Held here rather than in the boarding draft because a boarding request
  // does not carry a dog profile — it carries names and dates. These go to the
  // enrollment that travels with it, and are indexed alongside draft.dogNames
  // so the two stay in step as dogs are added and removed.
  const [dogProfiles, setDogProfiles] = useState<DogDraft[]>(() => [emptyDog()]);

  function set<K extends keyof BoardingRequestDraft>(key: K, value: BoardingRequestDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function setDogName(i: number, value: string) {
    setDraft((d) => ({ ...d, dogNames: d.dogNames.map((n, x) => (x === i ? value : n)) }));
    // The name lives in two places — the booking needs it, and so does the
    // enrollment. Typed once, in the field above the dates.
    setDogProfiles((prev) =>
      prev.map((p, x) => (x === i ? { ...p, dog_name: value } : p))
    );
  }

  function setDogProfile(i: number, patch: Partial<DogDraft>) {
    setDogProfiles((prev) => prev.map((p, x) => (x === i ? { ...p, ...patch } : p)));
  }

  function addDog() {
    setDraft((d) => ({ ...d, dogNames: [...d.dogNames, ""] }));
    setDogProfiles((prev) => [...prev, emptyDog()]);
  }

  function removeDog(i: number) {
    setDraft((d) => ({ ...d, dogNames: d.dogNames.filter((_, x) => x !== i) }));
    setDogProfiles((prev) => prev.filter((_, x) => x !== i));
  }

  // The dogs handed to the enrollment: one per name actually typed, carrying
  // whatever has been said about it. Names are the source of truth, so a dog
  // removed from the booking cannot be left behind in the enrollment.
  const enrollmentDogs: DogDraft[] = draft.dogNames.map((name, i) => ({
    ...(dogProfiles[i] ?? emptyDog()),
    dog_name: name,
  }));

  function toggleService(key: BoardingAddonKey, on: boolean) {
    setDraft((d) => ({
      ...d,
      services: on ? [...d.services, key] : d.services.filter((s) => s !== key),
    }));
  }

  async function handleSubmit() {
    // The shared validator says "Enter your dog's name", which is the wrong
    // instruction next to a list of tick boxes.
    if (knownDogs?.length && !cleanDogNames(draft).length) {
      setError("Tick which of your dogs is coming.");
      return;
    }
    const problem = validateBoardingRequest(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      // One button, two submissions. The enrollment goes first: if it fails
      // validation there is no point filing a stay for a dog with no profile,
      // and the enrollment form shows its own reason inline.
      if (enrollingHere) {
        const ok = await enrollmentRef.current?.submit();
        if (!ok) {
          setError("Please finish the enrollment form above, then send again.");
          return;
        }
      }
      await submitBoardingRequest(draft, source);
      await sendBoardingAcknowledgement(draft);
      await notifyStaffOfBoarding(draft);
      setDone(true);
    } catch (e) {
      console.error("Boarding request failed:", e);
      setError("Couldn't send that — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const nights = nightsFor(draft);
  const dogs = cleanDogNames(draft);
  const notEnrolled = draft.alreadyEnrolled === false;
  const [enrollmentSent, setEnrollmentSent] = useState(false);
  const enrollmentRef = useRef<EnrollmentFormHandle>(null);
  // The embedded enrollment reuses these four rather than asking again, so
  // they have to exist before it can render.
  const contactReady =
    !!draft.owner_name.trim() &&
    !!draft.last_name.trim() &&
    draft.phone.replace(/\D/g, "").length >= 7 &&
    /^\S+@\S+\.\S+$/.test(draft.email.trim());
  // True while the embedded enrollment is on screen and unsent — that is when
  // the single submit covers both forms. No longer gated on a reveal button:
  // the remaining questions are shown as soon as there are contact details to
  // hang them on, so this must follow the same condition the markup does or
  // the submit will skip an enrollment the customer has filled in.
  const enrollingHere = notEnrolled && contactReady && !enrollmentSent;

  // Scrolled after the confirmation has rendered, and instantly.
  //
  // It used to smooth-scroll from inside the submit handler, while the tall
  // form was still on screen. The document then collapsed to a short
  // confirmation mid-animation, leaving the viewport parked far below the
  // new end of the page — a blank white screen until something (a click)
  // made the browser clamp the scroll back.
  useEffect(() => {
    if (done) window.scrollTo(0, 0);
  }, [done]);

  if (done) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-20 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-accent-500 text-3xl text-accent-ink shadow-card">
          ✓
        </div>
        <p className="text-lg font-medium text-ink">Request sent.</p>
        <p className="text-sm text-ink-3">
          We&apos;ll check availability for {dogs.join(" and ") || "your dog"} and email you to
          confirm. <strong className="font-medium text-ink-2">This isn&apos;t booked yet</strong> —
          please wait for our confirmation before dropping off.
        </p>
        {!embed && (
          <Link
            href={homeHref}
            className="mt-2 rounded-xl bg-accent-500 px-6 py-2.5 text-sm font-medium text-accent-ink shadow-card transition hover:bg-accent-600"
          >
            Back to the start
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className={`mx-auto max-w-2xl ${embed ? "px-4 py-6" : "px-5 py-10 sm:px-8"}`}>
      {!embed && (
        <div className="mb-8 text-center">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Boarding request
          </h1>
          <p className="mt-1 text-sm text-ink-3">
            {settings.business.name} — tell us your dates and we&apos;ll confirm by email
          </p>
        </div>
      )}

      {/* Policy up front: it sets expectations before anyone fills in dates,
          and two of these are the reasons a request gets turned down. */}
      <Section title="Before you book" step={1}>
        <ul className="space-y-2 text-sm text-ink-2">
          <li className="flex gap-2">
            <span>📅</span>
            <span>
              Please request a stay at least <strong>{NOTICE_DAYS} days</strong> ahead.
            </span>
          </li>
          <li className="flex gap-2">
            <span>📝</span>
            <span>
              {/* Was a link to /enroll. That was the dead end this form
                  removed: a household that is not enrolled now answers "no"
                  below and fills it in here, so sending them to a separate
                  page loses everything they have typed and the booking with
                  it. The wording is the business's, from Settings. */}
              {settings.forms.bookIntro}
            </span>
          </li>
          <li className="flex gap-2">
            <span>🐕</span>
            <span>One daycare day before a first stay is strongly recommended.</span>
          </li>
          <li className="flex gap-2">
            <span>✉️</span>
            <span>
              <strong>Wait for our confirmation before dropping off.</strong> Sending this form
              doesn&apos;t hold the dates.
            </span>
          </li>
        </ul>
        <label className="mt-3 flex items-start gap-2">
          <input
            type="checkbox"
            checked={draft.policyAgreed}
            onChange={(e) => set("policyAgreed", e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-accent-500 focus:ring-accent-100"
          />
          <span className="text-sm text-ink-2">
            I&apos;ve read the above.<span className="ml-0.5 text-rose-500">*</span>
          </span>
        </label>
      </Section>

      {/* Owner */}
      <Section title="Your details" step={2}>
        {/* Signed in, so these came from the account rather than from
            somebody typing them again. Shown back rather than asked: this is
            also how a household ends up in the book twice, under two
            spellings of the same name. */}
        {lockContact ? (
          <div className="rounded-xl border border-line-soft bg-surface-2 px-3.5 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
              Sending as
            </p>
            <p className="mt-1 text-sm text-ink-2">
              {[draft.owner_name, draft.last_name].filter(Boolean).join(" ") || "Your account"}
              <span className="text-ink-3">
                {draft.phone ? ` · ${draft.phone}` : ""}
                {draft.email ? ` · ${draft.email}` : ""}
              </span>
            </p>
            <p className="mt-1 text-[11px] text-ink-3">
              Change these under{" "}
              <Link href="/account/details" className="text-accent-600 underline">
                Your details
              </Link>
              .
            </p>
          </div>
        ) : (
        <>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name" required>
            <input
              value={draft.owner_name}
              onChange={(e) => set("owner_name", e.target.value)}
              autoComplete="given-name"
              className={inputClass}
            />
          </Field>
          <Field label="Last name" required>
            <input
              value={draft.last_name}
              onChange={(e) => set("last_name", e.target.value)}
              autoComplete="family-name"
              className={inputClass}
            />
          </Field>
          <Field label="Phone number" required>
            <input
              value={draft.phone}
              onChange={(e) => set("phone", formatPhoneInput(e.target.value))}
              placeholder="(123) 456-7890"
              inputMode="tel"
              autoComplete="tel"
              className={inputClass}
            />
          </Field>
          <Field label="Email" required hint="This is where the confirmation goes.">
            <input
              type="email"
              value={draft.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="name@example.com"
              autoComplete="email"
              className={inputClass}
            />
          </Field>
        </div>
        </>
        )}

        {/* The enrollment question used to sit here, before anything had been
            said about the dog. Answering "no" opened an enrollment form whose
            first field was the dog's name — a name the booking asks for again
            further down. It now sits under the dates, where the dog has
            already been named and can be described once. */}
      </Section>

      {/* The rest of the form stays open whether or not the dog is enrolled.
          A request from a new client is worth having: staff can see the dates
          they want while they review the enrollment, rather than losing the
          booking to a redirect. */}
      <>
      {/* Dogs and dates */}
      <Section title="Dogs and dates" step={3}>
        {knownDogs?.length ? (
          // Ticked, not typed. The approval matches each name against the
          // dogs on the number, so a stay requested for "Bailey" when the
          // profile says "Baley" arrives unmatched and has to be sorted out
          // by hand — and the account already knows the spelling.
          <Field label="Who is coming?" required>
            <div className="space-y-1.5">
              {knownDogs.map((name) => (
                <label key={name} className="flex items-center gap-2 text-sm text-ink-2">
                  <input
                    type="checkbox"
                    checked={draft.dogNames.includes(name)}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        dogNames: e.target.checked
                          ? [...d.dogNames.filter((n) => n !== name), name]
                          : d.dogNames.filter((n) => n !== name),
                      }))
                    }
                    className="h-4 w-4 shrink-0 rounded border-line text-accent-500 focus:ring-accent-100"
                  />
                  <span>{name}</span>
                </label>
              ))}
            </div>
          </Field>
        ) : (
          // Typed here whether or not they are enrolled. The embedded
          // enrollment no longer asks for the name, so this is the only place
          // it is given and the two submissions cannot disagree about who is
          // coming.
          <>
        <div className="space-y-2">
          {draft.dogNames.map((name, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1">
                <Field label={i === 0 ? "Dog's name" : `Additional dog`} required={i === 0}>
                  <input
                    value={name}
                    onChange={(e) => setDogName(i, e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>
              {draft.dogNames.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeDog(i)}
                  className="mb-0.5 rounded-xl border border-line px-3 py-2.5 text-xs text-ink-3 hover:border-rose-300 hover:text-rose-500"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addDog}
          className="mt-2 w-full rounded-xl border border-dashed border-line px-3 py-2 text-xs font-medium text-ink-3 transition hover:border-accent-400 hover:text-accent-600"
        >
          + Add another dog
        </button>
          </>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Drop-off date" required>
            <DateField
              value={draft.start_date}
              onChange={(v) => set("start_date", v)}
              className={inputClass}
              ariaLabel="Drop-off date"
            />
          </Field>
          <Field label="Pick-up date" required>
            <DateField
              value={draft.end_date}
              onChange={(v) => set("end_date", v)}
              className={inputClass}
              ariaLabel="Pick-up date"
            />
          </Field>
        </div>

        {nights > 0 && (
          <p className="mt-2 text-xs font-medium text-ink-2">
            {prettyDateKey(draft.start_date)} → {prettyDateKey(draft.end_date)} ·{" "}
            {nights} night{nights === 1 ? "" : "s"}
          </p>
        )}
        {/* Warned, not blocked — staff can still take a short-notice stay. */}
        {isShortNotice(draft.start_date) && noticeDays(draft.start_date) >= 0 && (
          <p className="mt-2 rounded-xl bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
            That&apos;s less than {NOTICE_DAYS} days away. Send it through and we&apos;ll do our
            best, but we may not be able to fit it in.
          </p>
        )}

        {/* Asked here, under the dates, rather than up in the contact
            section: by this point the dog has a name, so a "no" can open an
            enrollment that already knows who it is about. */}
        <div className="mt-5 border-t border-line-soft pt-4">
          {/* Not asked when the dogs are already on the account: a household
              with records here is enrolled, and asking anyway invites a "no"
              that opens an enrollment form for a dog we have had for years. */}
          {!knownDogs?.length && (
            <Field label={`Is your dog already enrolled with ${settings.business.name}?`} required>
              <YesNo value={draft.alreadyEnrolled} onChange={(v) => set("alreadyEnrolled", v)} />
            </Field>
          )}

          {/* Who the dog is, asked here rather than inside the enrollment
              below, so everything about the dog sits under the name and dates
              it was given. What is left for the enrollment is only what this
              form has no business asking: the vaccination record, the meet &
              greet, and the agreements. */}
          {notEnrolled &&
            enrollmentDogs.map((dog, i) => (
              <div key={i} className="mt-3 space-y-5 rounded-2xl border border-line bg-surface-2 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                  About {dog.dog_name.trim() || `dog ${i + 1}`}
                </p>
                <DogBasics dog={dog} onChange={(patch) => setDogProfile(i, patch)} hideName />
              </div>
            ))}

          {/* One line, then the questions.
              This used to be a coloured panel explaining that an enrollment
              was needed, above a button that opened a second form inside the
              first. Both are gone: the remaining questions are short enough to
              simply ask, and a button labelled "open the enrollment form" made
              a five-field job look like starting over. */}
          {notEnrolled && !enrollmentSent && (
            <p className="mt-4 border-t border-line-soft pt-4 text-xs leading-relaxed text-ink-2">
              New dogs need a vaccination record and a meet &amp; greet before their first
              stay. Add those below and send everything together — we&apos;ll confirm the
              dates once it is approved.
            </p>
          )}

          {notEnrolled && enrollmentSent && (
            <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800">
              ✓ Enrollment sent. We&apos;ll review the profile and your dates together.
            </p>
          )}

          {/* The enrollment cannot open until the contact details exist: it
              reuses them rather than asking twice, so without them it would
              fail validation on fields that are no longer on screen. */}
          {notEnrolled && !contactReady && (
            <p className="mt-3 text-xs font-medium text-amber-800">
              Fill in your name, phone and email above and the rest appears here.
            </p>
          )}

          {notEnrolled && contactReady && !enrollmentSent && (
            <div className="mt-2">
              <EnrollmentForm
                ref={enrollmentRef}
                source="web"
                embed
                lockContact
                lockDogBasics
                hideSubmit
                prefill={{
                  owner_name: draft.owner_name,
                  last_name: draft.last_name,
                  phone: draft.phone,
                  email: draft.email,
                  // The dogs, described above. No onDogNamesChange any more:
                  // names now flow one way, from this form into the
                  // enrollment, so there is no round trip to disagree over.
                  dogs: enrollmentDogs,
                }}
                onSubmitted={() => {
                  setEnrollmentSent(true);
                }}
              />
            </div>
          )}
        </div>
      </Section>

      {/* Extras
          Titled for the stay, not "Anything else?". Following an enrollment
          form, a heading that vague reads as more enrollment — and these are
          add-ons charged on this booking, not standing preferences. */}
      <Section title="Extras for this stay" step={4}>
        <Field
          label="Add these to the stay"
          hint="Charged on this booking. Leave all unticked if none are needed."
        >
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {BOARDING_SERVICES.map((s) => (
              <label key={s.key} className="flex items-center gap-2 text-sm text-ink-2">
                <input
                  type="checkbox"
                  checked={draft.services.includes(s.key)}
                  onChange={(e) => toggleService(s.key, e.target.checked)}
                  className="h-4 w-4 shrink-0 rounded border-line text-accent-500 focus:ring-accent-100"
                />
                <span>{s.label}</span>
              </label>
            ))}
          </div>
        </Field>

        {draft.services.includes("walk") && (
          <div className="mt-3">
            <Field label="How many walks a day?" required>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: MAX_WALKS_PER_DAY }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => set("walksPerDay", n)}
                    className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
                      draft.walksPerDay === n
                        ? "border-accent-500 bg-accent-500 text-accent-ink shadow-card"
                        : "border-line bg-surface text-ink-2 hover:border-accent-300"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        )}

        {draft.services.includes("medication") && (
          <div className="mt-3">
            <Field label="Medication details" required hint="What, how much, and when.">
              <textarea
                value={draft.medicationInstructions}
                onChange={(e) => set("medicationInstructions", e.target.value)}
                rows={2}
                className={inputClass}
              />
            </Field>
          </div>
        )}

        <PriceDisclaimer draft={draft} />

        <div className="mt-3 grid gap-3">
          <Field
            label="Feeding instructions for the stay"
            required
            hint="What we feed them while they are with us."
          >
            <textarea
              value={draft.feedingInstructions}
              onChange={(e) => set("feedingInstructions", e.target.value)}
              rows={2}
              placeholder="How much, how often, anything to avoid"
              className={inputClass}
            />
          </Field>
          <Field label="Any other service you'd like?">
            <input
              value={draft.otherServices}
              onChange={(e) => set("otherServices", e.target.value)}
              placeholder="Something not listed above"
              className={inputClass}
            />
          </Field>
          <Field label="Comments or questions">
            <textarea
              value={draft.comments}
              onChange={(e) => set("comments", e.target.value)}
              rows={3}
              className={inputClass}
            />
          </Field>
        </div>
      </Section>

      {error && (
        <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <BusyButton
          busy={submitting}
          busyLabel="Sending your request…"
          onClick={handleSubmit}
        >
          {enrollingHere ? "Send enrollment & request dates" : "Request these dates"}
        </BusyButton>
        <p className="text-xs text-ink-3">
          We&apos;ll email you to confirm — nothing is held until then.
        </p>
        {!embed && (
          <Link href={homeHref} className="ml-auto text-xs font-medium text-ink-3 hover:text-ink-2">
            Back
          </Link>
        )}
      </div>
      </>
    </div>
  );
}

// A running estimate of what the stay will cost, built from the same
// pricing functions the front desk bills with — so the number a client is
// quoted here and the one they pay come from one place.
//
// The bath is quoted as a range rather than a figure: it is priced by size,
// and this form deliberately does not ask an owner to size their own dog.
function PriceDisclaimer({ draft }: { draft: BoardingRequestDraft }) {
  const nights = nightsFor(draft);
  if (!draft.start_date || !draft.end_date) return null;

  const estimate = estimateBoardingTotal(draft.start_date, draft.end_date, {
    // Bath is left out of the total on purpose — see above. It is listed
    // underneath as a range instead.
    addons: draft.services.filter((s) => s !== "bath"),
    walksPerDay: draft.walksPerDay,
    bathSize: null,
  });

  const bath = draft.services.includes("bath");
  const bathPrices = BATH_PRICES;

  return (
    <div className="mt-4 rounded-xl border border-line-soft bg-surface-2 p-3.5">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
        Estimated cost
      </p>
      <ul className="space-y-1 text-sm">
        {estimate.breakdown.map((b) => (
          <li key={b.label} className="flex items-baseline justify-between gap-3">
            <span className="text-ink-2">{b.label}</span>
            <span className="whitespace-nowrap font-medium text-ink-2">
              ${b.amount.toFixed(2)}
            </span>
          </li>
        ))}
        {bath && (
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-ink-2">Bath (by size)</span>
            <span className="whitespace-nowrap font-medium text-ink-2">
              ${bathPrices.S.toFixed(2)}–${bathPrices.L.toFixed(2)}
            </span>
          </li>
        )}
      </ul>
      <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-line-soft pt-2">
        <span className="text-sm font-semibold text-ink">
          {bath ? "Estimated total (before bath)" : "Estimated total"}
        </span>
        <span className="text-base font-semibold text-ink">${estimate.amount.toFixed(2)}</span>
      </div>
      <p className="mt-2 text-[11px] text-ink-3">
        An estimate, not a bill. {nights} night{nights === 1 ? "" : "s"} at $
        {PRICING.boardingPerNight.toFixed(2)}
        {draft.services.includes("walk") &&
          `, walks at $${BOARDING_ADDON_PRICES.walkPerWalk.toFixed(2)} each`}
        {bath && ", bath priced once we see your dog"}. The final total is worked out at pick-up
        and may change if dates or services do.
      </p>
    </div>
  );
}

function Section({
  title,
  step,
  children,
}: {
  title: string;
  step: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 rounded-3xl bg-surface p-5 shadow-card sm:p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-500 text-[11px] font-semibold text-accent-ink">
          {step}
        </span>
        <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
      </div>
      {children}
    </section>
  );
}
