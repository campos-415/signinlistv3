"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { prettyDateKey, todayKey } from "@/lib/dates";
import { dogHref, ownerHref } from "@/lib/dogs";
import { renderTemplate, sendEmail } from "@/lib/email";
import { useSettings } from "@/components/SettingsProvider";
import {
  BoardingRequestDraft,
  NOTICE_DAYS,
  approveBoardingRequest,
  boardingTemplateVars,
  cleanDogNames,
  isShortNotice,
  matchDogs,
  nightsFor,
  noticeDays,
  rejectBoardingRequest,
} from "@/lib/boardingRequest";
import { hasWaiver } from "@/lib/dogs";
import {
  STATUS_CLASSES,
  STATUS_LABELS,
  VaccineStatus,
  overallVaccineStatus,
} from "@/lib/vaccines";
import {
  BOARDING_SERVICES,
  BoardingRequest,
  Dog,
  EnrollmentStatus,
  Vaccination,
} from "@/types";

const TABS: { key: EnrollmentStatus; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Confirmed" },
  { key: "rejected", label: "Declined" },
];

interface Compose {
  row: BoardingRequest;
  outcome: "approved" | "rejected";
  to: string;
  subject: string;
  body: string;
}

// What the app already knows about the dogs on a request, resolved when
// staff open it. The client's own "already enrolled?" answer is a claim;
// this is the check.
interface DogCheck {
  name: string;
  dog: Dog | null;
  waiver: boolean;
  vaccines: VaccineStatus | null; // null when there is no profile to check
}

export default function BoardingRequests() {
  const { settings } = useSettings();
  const [rows, setRows] = useState<BoardingRequest[]>([]);
  const [tab, setTab] = useState<EnrollmentStatus>("pending");
  const [openId, setOpenId] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, DogCheck[]>>({});
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
      const { data, error: err } = await supabase
        .from("boarding_requests")
        .select(
          "id, phone, owner_name, last_name, email, dog_names, start_date, end_date, status, source, review_note, reviewed_at, created_at"
        )
        // Soonest drop-off first: a stay next week matters more than one in
        // three months, whatever order they were submitted in.
        .order("start_date", { ascending: true })
        .limit(300);
      if (err) throw err;
      setRows((data as BoardingRequest[]) ?? []);
    } catch (e) {
      console.error("Loading boarding requests failed:", e);
      setError(
        "Could not load booking requests — check that the `boarding_requests` table exists (see the README)."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => rows.filter((r) => r.status === tab), [rows, tab]);
  const pendingCount = useMemo(() => rows.filter((r) => r.status === "pending").length, [rows]);

  async function withData(row: BoardingRequest): Promise<BoardingRequest> {
    if (row.data) return row;
    const supabase = getSupabase();
    const { data, error: err } = await supabase
      .from("boarding_requests")
      .select("data")
      .eq("id", row.id)
      .single();
    if (err) throw err;
    return { ...row, data: (data as { data: unknown }).data };
  }

  async function openRow(row: BoardingRequest) {
    if (openId === row.id) {
      setOpenId(null);
      return;
    }
    setOpenId(row.id ?? null);
    try {
      const full = await withData(row);
      setRows((prev) => prev.map((r) => (r.id === row.id ? full : r)));
      if (row.id && !checks[row.id]) {
        setChecks((prev) => ({ ...prev, [row.id!]: [] })); // mark in-flight
        const matched = await matchDogs(row.phone, row.dog_names ?? []);
        const supabase = getSupabase();
        const resolved: DogCheck[] = [];
        for (const m of matched) {
          let vaccines: VaccineStatus | null = null;
          if (m.dog?.id) {
            const { data } = await supabase
              .from("vaccinations")
              .select("*")
              .eq("dog_id", m.dog.id);
            vaccines = overallVaccineStatus((data as Vaccination[]) ?? []);
          }
          resolved.push({
            name: m.name,
            dog: m.dog,
            waiver: m.dog ? hasWaiver(m.dog) : false,
            vaccines,
          });
        }
        setChecks((prev) => ({ ...prev, [row.id!]: resolved }));
      }
    } catch (e) {
      console.error("Opening request failed:", e);
      setError("Could not open that request.");
    }
  }

  function openCompose(
    row: BoardingRequest,
    outcome: "approved" | "rejected",
    draft: BoardingRequestDraft
  ) {
    const vars = boardingTemplateVars(draft);
    const e = settings.email;
    setCompose({
      row,
      outcome,
      to: draft.email?.trim() ?? row.email ?? "",
      subject: renderTemplate(
        outcome === "approved" ? e.boardingConfirmedSubject : e.boardingDeclinedSubject,
        vars
      ),
      body: renderTemplate(
        outcome === "approved" ? e.boardingConfirmedBody : e.boardingDeclinedBody,
        vars
      ),
    });
  }

  async function approve(row: BoardingRequest) {
    setBusyId(row.id ?? null);
    setError("");
    setNotice("");
    try {
      const full = await withData(row);
      const result = await approveBoardingRequest(full);
      setNotice(
        `Booked ${result.created.join(", ")} for ${prettyDateKey(row.start_date)} → ${prettyDateKey(
          row.end_date
        )}.` +
          (result.unmatched.length
            ? ` ⚠️ No profile on file for ${result.unmatched.join(", ")} — the reservation exists but isn't linked to a dog.`
            : "")
      );
      setOpenId(null);
      openCompose(full, "approved", full.data as BoardingRequestDraft);
      load();
    } catch (e) {
      console.error("Approving boarding request failed:", e);
      setError("Could not confirm that — nothing was booked, so it's safe to try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function reject(row: BoardingRequest) {
    const note = window.prompt(
      `Decline ${row.owner_name}'s request for ${prettyDateKey(row.start_date)}?\n\nOptionally note why. Staff-only — you'll write the client's message next:`,
      ""
    );
    if (note === null) return;
    setBusyId(row.id ?? null);
    setError("");
    try {
      const full = await withData(row);
      await rejectBoardingRequest(row, note);
      setOpenId(null);
      openCompose(full, "rejected", full.data as BoardingRequestDraft);
      load();
    } catch (e) {
      console.error("Declining boarding request failed:", e);
      setError("Could not update that request.");
    } finally {
      setBusyId(null);
    }
  }

  async function sendCompose() {
    if (!compose) return;
    if (!compose.to.trim()) {
      setError("No email address on that request — send it yourself.");
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
          "Email isn't set up yet — add RESEND_API_KEY to .env.local and a From address under Settings → Email. The booking was still saved."
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
                ? "bg-accent-500 text-white shadow-card"
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
        <Link
          href="/boardings"
          className="ml-auto rounded-xl border border-line bg-surface px-3.5 py-2 text-xs font-medium text-ink-2 hover:border-accent-300"
        >
          🛏️ Calendar →
        </Link>
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
              {compose.outcome === "approved" ? "✅ Confirmed" : "Declined"} — send{" "}
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
              className={`${inputClass} leading-relaxed`}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={sendCompose}
              disabled={sending}
              className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow-card hover:bg-accent-600 disabled:opacity-60"
            >
              {sending ? "Sending…" : "Send email"}
            </button>
            <p className="text-[11px] text-ink-3">
              Wording comes from{" "}
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
            const past = row.end_date < todayKey();
            return (
              <div key={row.id} className="rounded-2xl border border-line bg-surface shadow-card">
                <div className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">
                      🛏️ {row.dog_names?.join(", ") || "—"}
                      <span className="ml-2 text-xs font-normal text-ink-3">
                        {row.owner_name} {row.last_name} · {row.phone}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-ink-2">
                      {prettyDateKey(row.start_date)} → {prettyDateKey(row.end_date)}
                      <span className="text-ink-3">
                        {" "}
                        · asked {prettyDateKey((row.created_at ?? "").slice(0, 10))}
                        {row.source && ` · ${row.source === "web" ? "website" : "front desk"}`}
                      </span>
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {row.status === "pending" && isShortNotice(row.start_date) && !past && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                          ⏱ {noticeDays(row.start_date)} day
                          {noticeDays(row.start_date) === 1 ? "" : "s"} notice
                        </span>
                      )}
                      {row.status === "pending" && past && (
                        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600">
                          Dates have passed
                        </span>
                      )}
                    </div>
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
                        className="rounded-xl bg-accent-500 px-4 py-2 text-xs font-medium text-white shadow-card hover:bg-accent-600 disabled:opacity-60"
                      >
                        {busyId === row.id ? "Booking…" : "Confirm"}
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
                      {row.status === "approved" ? "Confirmed" : "Declined"}
                    </span>
                  )}

                  <Link
                    href={ownerHref(row.phone)}
                    className="text-xs font-medium text-accent-600 hover:underline"
                  >
                    Owner →
                  </Link>
                </div>

                {openId === row.id && (
                  <div className="border-t border-line-soft p-4">
                    {row.data ? (
                      <Review
                        draft={row.data as BoardingRequestDraft}
                        checks={row.id ? checks[row.id] : undefined}
                      />
                    ) : (
                      <p className="text-sm text-ink-3">Loading request…</p>
                    )}
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

function Review({ draft, checks }: { draft: BoardingRequestDraft; checks?: DogCheck[] }) {
  const nights = nightsFor(draft);
  const services = draft.services
    .map((s) => BOARDING_SERVICES.find((b) => b.key === s)?.label ?? s)
    .join(", ");

  return (
    <div className="space-y-4 text-sm">
      {/* The eligibility check. A dog with no profile, no waiver, or lapsed
          shots can be booked, but staff should know before they confirm. */}
      <div className="rounded-2xl border border-line-soft p-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
          Eligibility
        </p>
        <p className="mb-2 text-xs text-ink-3">
          Client says they are {draft.alreadyEnrolled ? "already enrolled" : "not enrolled yet"}.
          What we actually have on file:
        </p>
        {!checks ? (
          <p className="text-xs text-ink-3">Checking…</p>
        ) : (
          <ul className="space-y-1">
            {checks.map((c) => (
              <li key={c.name} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-ink-2">{c.name}</span>
                {c.dog ? (
                  <>
                    <Link
                      href={dogHref(c.dog.id!)}
                      className="text-accent-600 hover:underline"
                    >
                      profile →
                    </Link>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        c.waiver ? "bg-emerald-50 text-emerald-700" : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {c.waiver ? "waiver ✓" : "no waiver"}
                    </span>
                    {c.vaccines && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_CLASSES[c.vaccines]}`}
                      >
                        💉 {STATUS_LABELS[c.vaccines]}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600">
                    no profile on file — needs enrollment
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-line-soft p-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Stay</p>
        <Row label="Dates" value={`${prettyDateKey(draft.start_date)} → ${prettyDateKey(draft.end_date)}`} />
        <Row label="Nights" value={String(nights)} />
        <Row label="Notice given" value={`${noticeDays(draft.start_date)} days (asks for ${NOTICE_DAYS})`} />
        <Row label="Services" value={services || "None requested"} />
        <Row label="Other requested" value={draft.otherServices} />
        <Row label="Medication" value={draft.medicationInstructions} />
        <Row label="Feeding" value={draft.feedingInstructions} />
        <Row label="Comments" value={draft.comments} />
        <Row label="Email" value={draft.email} />
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100";

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 py-0.5 text-xs">
      <span className="w-36 shrink-0 text-ink-3">{label}</span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap text-ink-2">{value}</span>
    </div>
  );
}
