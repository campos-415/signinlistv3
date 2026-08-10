"use client";

import Link from "next/link";
import { useState } from "react";
import DateField from "@/components/DateField";
import { Field, YesNo, inputClass } from "@/components/FormBits";
import { formatPhoneInput } from "@/lib/phone";
import { useSettings } from "@/components/SettingsProvider";
import { prettyDateKey } from "@/lib/dates";
import {
  BATH_PRICES,
  BOARDING_ADDON_PRICES,
  PRICING,
  estimateBoardingTotal,
} from "@/lib/pricing";
import {
  BoardingRequestDraft,
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

export default function BoardingRequestForm({
  source,
  embed = false,
}: {
  source: "kiosk" | "web";
  // Drops the heading and back link, for embedding in an iframe on the
  // business's own website.
  embed?: boolean;
}) {
  const { settings } = useSettings();
  // The kiosk sends people back to the sign-in screen; the website sends
  // them back to the website.
  const homeHref = source === "kiosk" ? "/kiosk" : "/";
  const [draft, setDraft] = useState<BoardingRequestDraft>(emptyBoardingRequest());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  function set<K extends keyof BoardingRequestDraft>(key: K, value: BoardingRequestDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function setDogName(i: number, value: string) {
    setDraft((d) => ({ ...d, dogNames: d.dogNames.map((n, x) => (x === i ? value : n)) }));
  }

  function toggleService(key: BoardingAddonKey, on: boolean) {
    setDraft((d) => ({
      ...d,
      services: on ? [...d.services, key] : d.services.filter((s) => s !== key),
    }));
  }

  async function handleSubmit() {
    const problem = validateBoardingRequest(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await submitBoardingRequest(draft, source);
      await sendBoardingAcknowledgement(draft);
      await notifyStaffOfBoarding(draft);
      setDone(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
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
              Every boarding dog must have completed{" "}
              <Link href="/enroll" className="text-accent-600 underline">
                enrollment
              </Link>{" "}
              and a meet &amp; greet first, with vaccination records up to date.
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

        <div className="mt-3">
          <Field label={`Is your dog already enrolled with ${settings.business.name}?`} required>
            <YesNo
              value={draft.alreadyEnrolled}
              onChange={(v) => set("alreadyEnrolled", v)}
            />
          </Field>
          {/* A hard stop, not a warning. Boarding is only offered to
              enrolled dogs, and letting the request through would just
              create one staff have to decline. */}
          {draft.alreadyEnrolled === false && (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-900">
                Please complete enrollment first.
              </p>
              <p className="mt-1 text-xs text-amber-800">
                Every boarding dog needs an enrollment form and a meet &amp; greet on file before we
                can take a stay. It only takes a few minutes, and you won&apos;t need to do it
                again.
              </p>
              <Link
                href="/enroll"
                className="mt-3 inline-block rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-amber-700"
              >
                Go to the enrollment form →
              </Link>
              <p className="mt-2 text-[11px] text-amber-800">
                Once we&apos;ve approved it, come back and request your dates.
              </p>
            </div>
          )}
        </div>
      </Section>

      {/* Everything past this point is hidden while enrollment is
          outstanding — there is no point collecting dates for a stay that
          cannot be booked yet. */}
      {notEnrolled ? null : (
        <>
      {/* Dogs and dates */}
      <Section title="Dogs and dates" step={3}>
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
                  onClick={() =>
                    setDraft((d) => ({ ...d, dogNames: d.dogNames.filter((_, x) => x !== i) }))
                  }
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
          onClick={() => setDraft((d) => ({ ...d, dogNames: [...d.dogNames, ""] }))}
          className="mt-2 w-full rounded-xl border border-dashed border-line px-3 py-2 text-xs font-medium text-ink-3 transition hover:border-accent-400 hover:text-accent-600"
        >
          + Add another dog
        </button>

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
      </Section>

      {/* Extras */}
      <Section title="Anything else?" step={4}>
        <Field label="Additional services" hint="Leave all unticked if none are needed.">
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
          <Field label="Feeding instructions">
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
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="rounded-xl bg-accent-500 px-6 py-3 text-sm font-medium text-accent-ink shadow-card transition hover:bg-accent-600 disabled:opacity-60"
        >
          {submitting ? "Sending…" : "Request these dates"}
        </button>
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
      )}
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
