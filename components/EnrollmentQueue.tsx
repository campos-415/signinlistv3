"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { prettyDateKey } from "@/lib/dates";
import { ownerHref } from "@/lib/dogs";
import {
  ageFromBirthdate,
  approveEnrollment,
  rejectEnrollment,
  deleteEnrollment,
  templateVars,
} from "@/lib/enrollment";
import type { DogDraft, EnrollmentDraft } from "@/lib/enrollment";
import { renderTemplate, sendEmail } from "@/lib/email";
import { useSettings } from "@/components/SettingsProvider";
import RecordPreview from "@/components/RecordPreview";
import { Enrollment, EnrollmentStatus, VACCINES } from "@/types";
import { reviewChecks } from "@/lib/enrollmentReview";
import { todayKey } from "@/lib/dates";

const TABS: { key: EnrollmentStatus; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

// The message staff are about to send, held while they edit it.
interface Compose {
  row: Enrollment;
  outcome: "approved" | "rejected";
  to: string;
  subject: string;
  body: string;
}

export default function Enrollments({ onChanged }: { onChanged?: () => void } = {}) {
  const { settings } = useSettings();
  const [rows, setRows] = useState<Enrollment[]>([]);
  const [tab, setTab] = useState<EnrollmentStatus>("pending");
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [compose, setCompose] = useState<Compose | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const supabase = getSupabase();
      // `data` carries the uploaded paperwork and can be megabytes, so the
      // whole row is only pulled for the one submission being reviewed.
      const { data, error: err } = await supabase
        .from("enrollments")
        .select("id, phone, owner_name, last_name, dog_names, status, source, review_note, reviewed_at, created_at")
        .order("created_at", { ascending: false })
        .limit(300);
      if (err) throw err;
      setRows((data as Enrollment[]) ?? []);
    } catch (e) {
      console.error("Loading enrollments failed:", e);
      setError(
        "Could not load enrollment requests — check that the `enrollments` table exists (see the README)."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    onChanged?.();
  }, [load]);

  const visible = useMemo(() => rows.filter((r) => r.status === tab), [rows, tab]);
  const pendingCount = useMemo(() => rows.filter((r) => r.status === "pending").length, [rows]);

  async function openRow(row: Enrollment) {
    if (openId === row.id) {
      setOpenId(null);
      return;
    }
    setOpenId(row.id ?? null);
    if (row.data) return;
    try {
      const supabase = getSupabase();
      const { data, error: err } = await supabase
        .from("enrollments")
        .select("data")
        .eq("id", row.id)
        .single();
      if (err) throw err;
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, data: (data as { data: unknown }).data } : r))
      );
    } catch (e) {
      console.error("Loading submission failed:", e);
      setError("Could not open that submission.");
    }
  }

  // The list query leaves `data` out because it's heavy; anything that
  // needs the answers themselves pulls it on demand.
  async function withData(row: Enrollment): Promise<Enrollment> {
    if (row.data) return row;
    const supabase = getSupabase();
    const { data, error: err } = await supabase
      .from("enrollments")
      .select("data")
      .eq("id", row.id)
      .single();
    if (err) throw err;
    return { ...row, data: (data as { data: unknown }).data };
  }

  // Opens the message staff send after deciding. Pre-filled from the
  // template on /settings, then editable — the decision is already saved by
  // the time this appears, so closing it without sending is fine.
  function openCompose(row: Enrollment, outcome: "approved" | "rejected", draft: EnrollmentDraft) {
    const vars = templateVars(draft);
    const e = settings.email;
    setCompose({
      row,
      outcome,
      to: draft.owner?.email?.trim() ?? "",
      subject: renderTemplate(
        outcome === "approved" ? e.approvedSubject : e.declinedSubject,
        vars
      ),
      body: renderTemplate(outcome === "approved" ? e.approvedBody : e.declinedBody, vars),
    });
  }

  async function approve(row: Enrollment) {
    setBusyId(row.id ?? null);
    setError("");
    setNotice("");
    try {
      const full = await withData(row);
      const result = await approveEnrollment(full);
      const parts = [
        result.created.length ? `Added ${result.created.join(", ")}` : "",
        result.updated.length ? `Updated ${result.updated.join(", ")}` : "",
      ].filter(Boolean);
      setNotice(`${parts.join(" · ")} — they can check in by phone now.`);
      setOpenId(null);
      openCompose(full, "approved", full.data as EnrollmentDraft);
      load();
      onChanged?.();
    } catch (e) {
      console.error("Approving enrollment failed:", e);
      setError("Could not approve that — nothing was changed, so it's safe to try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function reject(row: Enrollment) {
    const note = window.prompt(
      `Turn down ${row.owner_name}'s enrollment?\n\nOptionally note why. This is a staff-only note — you'll get to write the client's message next:`,
      ""
    );
    if (note === null) return;
    setBusyId(row.id ?? null);
    setError("");
    try {
      const full = await withData(row);
      await rejectEnrollment(row, note);
      setOpenId(null);
      openCompose(full, "rejected", full.data as EnrollmentDraft);
      load();
      onChanged?.();
    } catch (e) {
      console.error("Rejecting enrollment failed:", e);
      setError("Could not update that request.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeRow(row: Enrollment) {
    const created = row.status === "approved";
    if (
      !window.confirm(
        `Delete ${row.owner_name} ${row.last_name}'s enrollment form?\n\n` +
          (created
            ? "The dog profiles it created stay on file — only this submission goes.\n\n"
            : "") +
          "This cannot be undone."
      )
    ) {
      return;
    }
    setBusyId(row.id ?? null);
    setError("");
    try {
      await deleteEnrollment(row);
      setOpenId(null);
      setNotice(`Deleted the form from ${row.owner_name} ${row.last_name}.`);
      load();
      onChanged?.();
    } catch (e) {
      console.error("Deleting enrollment failed:", e);
      setError("Could not delete that submission.");
    } finally {
      setBusyId(null);
    }
  }

  async function sendCompose() {
    if (!compose) return;
    if (!compose.to.trim()) {
      setError("No email address on that submission — add one and send it yourself.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const result = await sendEmail({
        to: compose.to.trim(),
        subject: compose.subject,
        body: compose.body,
      });
      if (result.skipped) {
        setError(
          "Email isn't set up yet — add RESEND_API_KEY to .env.local and a From address under Settings → Email. The decision was still saved."
        );
        return;
      }
      if (result.error) {
        setError(`Could not send: ${result.error}`);
        return;
      }
      setNotice(`Message sent to ${compose.to.trim()}.`);
      setCompose(null);
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-xl px-3.5 py-2 text-xs font-medium transition ${
              tab === t.key
                ? "bg-accent-500 text-accent-ink shadow-card"
                : "border border-line bg-surface text-ink-2 hover:border-accent-300"
            }`}
          >
            {t.label}
            {t.key === "pending" && pendingCount > 0 && (
              <span className="ml-1.5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && <p className="mb-4 text-xs font-medium text-rose-500">{error}</p>}
      {notice && (
        <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          {notice}
        </p>
      )}

      {compose && (
        <div className="mb-5 rounded-2xl border border-accent-200 bg-accent-50/40 p-4 shadow-card">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-ink">
              {compose.outcome === "approved" ? "✅ Approved" : "Declined"} — send{" "}
              {compose.row.owner_name} a message
            </p>
            <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-semibold text-ink-3">
              Optional
            </span>
            <button
              onClick={() => setCompose(null)}
              className="ml-auto text-xs font-medium text-ink-3 hover:text-ink-2"
            >
              Skip
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] text-ink-3">To</label>
              <input
                value={compose.to}
                onChange={(e) => setCompose({ ...compose, to: e.target.value })}
                placeholder="No email on the submission"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-ink-3">Subject</label>
              <input
                value={compose.subject}
                onChange={(e) => setCompose({ ...compose, subject: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-[11px] text-ink-3">Message</label>
            <textarea
              value={compose.body}
              onChange={(e) => setCompose({ ...compose, body: e.target.value })}
              rows={10}
              className={`${inputClass} font-body leading-relaxed`}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={sendCompose}
              disabled={sending}
              className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-accent-ink shadow-card hover:bg-accent-600 disabled:opacity-60"
            >
              {sending ? "Sending…" : "Send email"}
            </button>
            <p className="text-[11px] text-ink-3">
              Edit anything before sending. The wording it starts from is on{" "}
              <Link href="/settings" className="text-accent-600 hover:underline">
                Settings → Email
              </Link>
              .
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink-3">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-8 text-center text-sm text-ink-3">
          {tab === "pending" ? "Nothing waiting for review." : `No ${tab} requests.`}
        </p>
      ) : (
        <div className="space-y-3">
          {visible.map((row) => {
            // One household can enrol several dogs on a single form —
            // approving it creates that many profiles, so the count belongs
            // on the card rather than being counted off the list of names.
            const dogCount = (row.dog_names ?? []).filter((n) => n.trim()).length;
            return (
            <div key={row.id} className="rounded-2xl border border-line bg-surface shadow-card">
              <div className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">
                    {row.owner_name} {row.last_name}
                    <span className="ml-2 text-xs font-normal text-ink-3">{row.phone}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-ink-3">
                    🐕 {row.dog_names?.join(", ") || "—"}
                    {dogCount > 1 && (
                      <span className="ml-1.5 rounded-full bg-accent-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-700">
                        {dogCount} dogs
                      </span>
                    )}{" "}
                    · submitted{" "}
                    {prettyDateKey((row.created_at ?? "").slice(0, 10))}
                    {row.source && ` · ${row.source === "web" ? "website" : "front desk"}`}
                  </p>
                  {row.review_note && (
                    <p className="mt-1 text-xs text-ink-3">Note: {row.review_note}</p>
                  )}
                </div>

                <button
                  onClick={() => openRow(row)}
                  className="rounded-xl border border-line px-3.5 py-2 text-xs font-medium text-ink-2 hover:border-accent-300"
                >
                  {openId === row.id ? "Hide" : "Review"}
                </button>

                {row.status === "pending" ? (
                  <>
                    <button
                      onClick={() => reject(row)}
                      disabled={busyId === row.id}
                      className="rounded-xl border border-rose-200 px-3.5 py-2 text-xs font-medium text-rose-500 hover:border-rose-300 disabled:opacity-60"
                    >
                      Decline
                    </button>
                    <button
                      onClick={() => approve(row)}
                      disabled={busyId === row.id}
                      className="rounded-xl bg-accent-500 px-4 py-2 text-xs font-medium text-accent-ink shadow-card hover:bg-accent-600 disabled:opacity-60"
                    >
                      {busyId === row.id ? "Approving…" : "Approve"}
                    </button>
                  </>
                ) : (
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      row.status === "approved"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-surface-3 text-ink-3"
                    }`}
                  >
                    {row.status === "approved" ? "Approved" : "Declined"}
                  </span>
                )}

              </div>

              {openId === row.id && (
                <div className="border-t border-line-soft p-4">
                  {row.data ? (
                    <Review draft={row.data as EnrollmentDraft & { signature?: string }} />
                  ) : (
                    <p className="text-sm text-ink-3">Loading submission…</p>
                  )}

                  {/* Housekeeping lives down here rather than beside Approve.
                      Deleting a submission is not part of reviewing one, and a
                      button that discards the paperwork does not belong a
                      thumb's width from the one that accepts it. */}
                  <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line-soft pt-3">
                    {row.status === "approved" && (
                      <Link
                        href={ownerHref(row.phone)}
                        className="text-xs font-medium text-accent-600 hover:underline"
                      >
                        Open the client profile →
                      </Link>
                    )}
                    <button
                      onClick={() => removeRow(row)}
                      disabled={busyId === row.id}
                      title="Delete this submission"
                      className="ml-auto text-xs font-medium text-ink-3 transition hover:text-rose-500 disabled:opacity-60"
                    >
                      🗑 Delete this submission
                    </button>
                  </div>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Review({ draft }: { draft: EnrollmentDraft & { signature?: string } }) {
  // A submission with no owner block should not take the whole Requests page
  // down with it. React unmounts the tree on a render throw, so one malformed
  // row — a half-written insert, a hand-edited jsonb — would white-screen the
  // queue that staff use to find it.
  const o = draft?.owner;
  if (!o) {
    return (
      <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
        This submission has no owner details saved, so there is nothing to review. Approving it
        would create nothing — decline it and ask the client to send the form again.
      </p>
    );
  }
  const summary = reviewChecks(draft, todayKey());

  return (
    <div className="space-y-5 text-sm">
      <ReviewVerdict summary={summary} />

      <Block title="Owner">
        <Row label="Name" value={`${o.owner_name} ${o.last_name}`} />
        <Row label="Phone" value={o.phone} />
        <Row label="Email" value={o.email} />
        <Row label="Address" value={[o.address, o.city, o.state, o.zip].filter(Boolean).join(", ")} />
        <Row
          label="Emergency"
          value={[o.emergency_name, o.emergency_phone, o.emergency_relation]
            .filter(Boolean)
            .join(" · ")}
        />
        <Row label="Authorized pick-up" value={o.authorized_pickup} />
        <Row label="Heard about us" value={o.heard_about} />
      </Block>

      <Block title="Veterinarian">
        <Row label="Hospital" value={o.vet_name} />
        <Row label="Phone" value={o.vet_phone} />
        <Row label="Address" value={o.vet_address} />
      </Block>

      {draft.dogs?.map((dog, i) => <DogReview key={i} dog={dog} />)}

      <Block title="Agreements">
        <Row label="Contract" value={draft.contractAgreed ? "Accepted" : "NOT accepted"} />
        <Row label="Meet & greet policy" value={draft.policyAgreed ? "Accepted" : "NOT accepted"} />
        {draft.signature && (
          <div className="pt-2">
            <p className="mb-1 text-[11px] text-ink-3">Signature</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={draft.signature}
              alt="Signature"
              className="h-24 rounded-xl border border-line bg-white object-contain p-1"
            />
          </div>
        )}
      </Block>
    </div>
  );
}

function DogReview({ dog }: { dog: DogDraft }) {
  const age = ageFromBirthdate(dog.birthdate);
  const fixed =
    dog.fixed === true
      ? "Yes"
      : dog.fixed === false
        ? `No${dog.fixed_scheduled_on ? ` — scheduled ${dog.fixed_scheduled_on}` : ""}`
        : "Not answered";

  // Anything that changes how staff handle the dog on day one, pulled out of
  // the long answer list so it can't be missed in a wall of text.
  const flags: string[] = [];
  if (dog.bitten) flags.push(`Has bitten${dog.bitten_note ? `: ${dog.bitten_note}` : ""}`);
  if (dog.growled) flags.push(`Has growled${dog.growled_note ? `: ${dog.growled_note}` : ""}`);
  if (dog.dog_fight) flags.push(`Dog fight${dog.dog_fight_note ? `: ${dog.dog_fight_note}` : ""}`);
  if (dog.climbed_fence) flags.push(`Climbs fences${dog.fence_height ? ` (${dog.fence_height})` : ""}`);
  if (dog.health_problems) flags.push(`Health: ${dog.health_notes || "unspecified"}`);
  if (dog.allergies?.length) flags.push(`Allergies: ${dog.allergies.join(", ")}`);
  if (dog.sensitive_areas)
    flags.push(`Touch-sensitive${dog.sensitive_areas_note ? `: ${dog.sensitive_areas_note}` : ""}`);

  const missingVax = VACCINES.filter((v) => !dog.vaccines?.[v.key]?.expires_on).map((v) => v.label);

  return (
    <Block title={`🐕 ${dog.dog_name || "Dog"}`}>
      {flags.length > 0 && (
        <div className="mb-3 rounded-xl bg-amber-50 p-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
            Needs attention
          </p>
          <ul className="list-inside list-disc space-y-0.5 text-xs text-amber-900">
            {flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      <Row label="Breed" value={dog.breed} />
      <Row label="Colour" value={dog.color} />
      <Row label="Born" value={dog.birthdate ? `${dog.birthdate}${age ? ` (${age})` : ""}` : ""} />
      <Row label="Weight" value={dog.weight_lb ? `${dog.weight_lb} lb` : ""} />
      <Row label="Gender" value={dog.sex} />
      <Row label="Spayed / neutered" value={fixed} />
      <Row label="Flea program" value={dog.flea_program} />
      <Row label="Came from" value={dog.dog_source} />
      <Row label="Restrictions" value={dog.activity_restrictions?.join(", ")} />
      <Row label="Traits" value={dog.behavior_traits?.join(", ")} />
      <Row label="At play" value={dog.play_style?.join(", ")} />
      <Row label="Expected visits" value={dog.attendance_plan} />
      <Row label="With big dogs" value={dog.big_dog_response} />
      <Row
        label="Trained"
        value={[dog.crate_trained ? "crate" : "", dog.kennel_trained ? "kennel" : ""]
          .filter(Boolean)
          .join(" + ")}
      />
      <Row label="Wants a package" value={dog.package_interest} />
      <Row
        label="Meet & greet requested"
        value={[dog.meet_greet_on, dog.meet_greet_window].filter(Boolean).join(" · ")}
      />

      <div className="mt-3 border-t border-line-soft pt-3">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
          Vaccinations
        </p>
        <ul className="space-y-0.5 text-xs text-ink-2">
          {VACCINES.map((v) => {
            const rec = dog.vaccines?.[v.key];
            return (
              <li key={v.key}>
                {v.label}: {rec?.expires_on ? `expires ${rec.expires_on}` : "—"}
                {rec?.given_on && <span className="text-ink-3"> (given {rec.given_on})</span>}
              </li>
            );
          })}
        </ul>
        {missingVax.length > 0 && (
          <p className="mt-1 text-xs text-amber-700">No date given for: {missingVax.join(", ")}</p>
        )}
        {dog.doc ? (
          <RecordPreview
            name={dog.doc.name}
            mime={dog.doc.mime}
            data={dog.doc.data}
            label="Vaccination record"
          />
        ) : (
          <p className="mt-2 text-xs text-rose-500">No records uploaded.</p>
        )}
      </div>
    </Block>
  );
}

const inputClass =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100";

// The answer to the only question a reviewer actually has, put where they
// look first instead of spread across four hundred pixels of form.
function ReviewVerdict({ summary }: { summary: ReturnType<typeof reviewChecks> }) {
  const { checks, blockers, warnings } = summary;

  if (checks.length === 0) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <p className="text-sm font-medium text-emerald-800">
          ✓ Nothing outstanding — signed, agreed, and every dog vaccinated with a record on file.
        </p>
      </div>
    );
  }

  const headline = [
    blockers > 0 && `${blockers} to fix`,
    warnings > 0 && `${warnings} to know about`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={`rounded-2xl border px-4 py-3 ${
        blockers > 0 ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50"
      }`}>
      <p
        className={`text-sm font-medium ${blockers > 0 ? "text-rose-800" : "text-amber-900"}`}>
        {blockers > 0 ? "⚠️" : "•"} {headline}
      </p>
      <ul className="mt-2 space-y-1">
        {checks.map((c, i) => (
          <li key={i} className="flex gap-2 text-xs">
            <span
              className={`shrink-0 font-semibold ${
                c.level === "blocker" ? "text-rose-600" : "text-amber-700"
              }`}>
              {c.level === "blocker" ? "✕" : "!"}
            </span>
            <span className={c.level === "blocker" ? "text-rose-900" : "text-amber-900"}>
              {c.scope && <span className="font-medium">{c.scope}: </span>}
              {c.label}
            </span>
          </li>
        ))}
      </ul>
      {blockers > 0 && (
        // Staff regularly have the certificate in their hand while the client
        // stands there. Refusing the approval would only push them to enter it
        // by hand somewhere the queue cannot see.
        <p className="mt-2 text-[11px] text-ink-3">
          You can still approve — this is a checklist to follow up on, not a lock.
        </p>
      )}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line-soft p-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{title}</p>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 py-0.5 text-xs">
      <span className="w-40 shrink-0 text-ink-3">{label}</span>
      <span className="min-w-0 flex-1 text-ink-2">{value}</span>
    </div>
  );
}
