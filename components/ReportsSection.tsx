"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { todayKey } from "@/lib/dates";
import { columnsOf, downloadCsv, stampedName, toCsv } from "@/lib/csv";
import {
  AccountRow,
  ReportData,
  accountRows,
  dogDirectoryRows,
  loadReportData,
  moneySummary,
  outstandingChargeRows,
} from "@/lib/reports";

// Settings -> Reports.
//
// Two different things staff mean by "a report", kept apart because they are
// used differently:
//
//   Printed  — a page already in the app, opened and printed for a shift or a
//              client. Links, not duplicates: the day report knows how to
//              print itself, and a second implementation here would drift.
//   Exported — a spreadsheet. Everything on file, for the questions nobody
//              anticipated, and for the ones about money.

const money = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD" });

export default function ReportsSection() {
  const [date, setDate] = useState(todayKey());
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await loadReportData());
    } catch (e) {
      console.error("Loading report data failed:", e);
      setError("Could not load the records. Check the connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const accounts = useMemo(() => (data ? accountRows(data) : []), [data]);
  const summary = useMemo(() => moneySummary(accounts), [accounts]);

  function save(stem: string, rows: Record<string, unknown>[]) {
    if (!rows.length) {
      setNote("Nothing to export there yet.");
      return;
    }
    downloadCsv(stampedName(stem), toCsv(rows, columnsOf(rows)));
    setNote(`Downloaded ${stem} — ${rows.length.toLocaleString()} rows.`);
  }

  const owing = accounts.filter((a) => a.outstanding > 0.005);
  const credits = accounts.filter((a) => a.outstanding < -0.005);

  return (
    <div className="space-y-5">
      {/* ---------- printable ---------- */}
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <h3 className="text-sm font-semibold text-ink">🖨️ Printable reports</h3>
        <p className="mt-0.5 text-xs text-ink-3">
          Each opens the page it belongs to, laid out for paper. Use the browser&rsquo;s print
          dialogue to print or save as PDF.
        </p>

        <div className="mt-3 max-w-[13rem]">
          <label className="mb-1 block text-[11px] text-ink-3">Date for the daily reports</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value || todayKey())}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent-500"
          />
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <ReportLink
            href={`/day-report?date=${date}`}
            title="End-of-day report"
            blurb="Revenue by category, service counts and the day's total."
          />
          <ReportLink
            href={`/in-house?date=${date}`}
            title="Sign-in list"
            blurb="Who was in, times, add-ons, package and price."
          />
          <ReportLink
            href={`/in-house?date=${date}&view=walklog`}
            title="Walk log"
            blurb="Every walk owed that day, daycare and boarding."
          />
          <ReportLink
            href="/calendar"
            title="Boarding calendar"
            blurb="Stays and meet & greets across the month."
          />
          <ReportLink
            href="/stay-report"
            title="Boarding stay report"
            blurb="One sheet per stay: feeding, medication, walk and meal logs."
          />
          <ReportLink
            href="/packages"
            title="Packages"
            blurb="Blocks on file with days used against days bought."
          />
        </div>
      </section>

      {/* ---------- money ---------- */}
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-ink">💰 Money owed</h3>
          <button
            onClick={load}
            disabled={loading}
            className="ml-auto rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-ink-2 hover:border-accent-300 disabled:opacity-60"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        <p className="mt-0.5 text-xs text-ink-3">
          Balances are per household — one family pays one bill covering every dog on the number.
          Payments settle the oldest charge first, which is what makes &ldquo;days overdue&rdquo;
          meaningful.
        </p>

        {loading && !data ? (
          <p className="mt-3 text-sm text-ink-3">Adding it up…</p>
        ) : (
          <>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Outstanding" value={money(summary.totalOutstanding)} tone="rose" />
              <Stat label="Credit held" value={money(summary.totalCredit)} tone="emerald" />
              <Stat label="Charged all time" value={money(summary.totalCharged)} />
              <Stat label="Paid all time" value={money(summary.totalPaid)} />
            </div>

            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              <Stat label="0–30 days" value={money(summary.current)} small />
              <Stat label="31–60 days" value={money(summary.days31to60)} small />
              <Stat label="61–90 days" value={money(summary.days61to90)} small />
              <Stat label="Over 90 days" value={money(summary.over90)} small tone="rose" />
            </div>

            <p className="mt-2 text-[11px] text-ink-3">
              {summary.households.toLocaleString()} households · {owing.length} owing ·{" "}
              {credits.length} in credit · {summary.settled} settled
            </p>

            {owing.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[34rem] border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-line text-ink-3">
                      <th className="py-1.5 pr-3 font-medium">Household</th>
                      <th className="py-1.5 pr-3 font-medium">Dogs</th>
                      <th className="py-1.5 pr-3 font-medium">Oldest unpaid</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Owed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {owing.slice(0, 12).map((a) => (
                      <tr key={a.phone} className="border-b border-line-soft text-ink-2">
                        <td className="py-1.5 pr-3">
                          <Link
                            href={`/owners/${encodeURIComponent(a.phone)}`}
                            className="font-medium text-accent-600 hover:underline"
                          >
                            {a.owner || a.phone}
                          </Link>
                          <span className="block text-[10px] text-ink-3">{a.phone}</span>
                        </td>
                        <td className="py-1.5 pr-3">{a.dogs}</td>
                        <td className="whitespace-nowrap py-1.5 pr-3">
                          {a.oldestUnpaidDate || "—"}
                          {a.daysOverdue > 0 && (
                            <span
                              className={`ml-1.5 rounded px-1 py-0.5 text-[10px] font-semibold ${
                                a.daysOverdue > 90
                                  ? "bg-rose-100 text-rose-700"
                                  : a.daysOverdue > 30
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-surface-3 text-ink-3"
                              }`}
                            >
                              {a.daysOverdue}d
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap py-1.5 pr-3 text-right font-semibold text-rose-600">
                          {money(a.outstanding)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {owing.length > 12 && (
                  <p className="mt-1.5 text-[11px] text-ink-3">
                    Showing the 12 largest of {owing.length}. The export has them all.
                  </p>
                )}
              </div>
            )}

            {credits.length > 0 && (
              <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-[11px] text-emerald-900">
                {credits.length} household{credits.length === 1 ? "" : "s"} in credit —{" "}
                {credits
                  .slice(0, 4)
                  .map((c) => `${c.owner || c.phone} ${money(-c.outstanding)}`)
                  .join(", ")}
                {credits.length > 4 ? ", …" : ""}. Credit is an overpayment carried forward; it
                comes off their next visit automatically.
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <Download
                label="Accounts + ageing"
                onClick={() => save("accounts-receivable", accounts as unknown as Record<string, unknown>[])}
              />
              <Download
                label="Outstanding charges"
                onClick={() => data && save("outstanding-charges", outstandingChargeRows(data))}
              />
              <Download
                label="Payments received"
                onClick={() => data && save("payments", data.payments as unknown as Record<string, unknown>[])}
              />
            </div>
          </>
        )}
      </section>

      {/* ---------- spreadsheets ---------- */}
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <h3 className="text-sm font-semibold text-ink">📄 Spreadsheets</h3>
        <p className="mt-0.5 text-xs text-ink-3">
          CSV, opens in Excel, Numbers or Google Sheets. Photos and signatures are left out —
          they are megabytes of encoded image and unreadable in a spreadsheet.
        </p>

        <div className="mt-3 space-y-2">
          <ExportRow
            title="Dogs and owners — everything on file"
            blurb="One row per dog: every profile answer, vaccination dates and status, age, visit counts, package balances, plus the whole owner record — address, email, emergency and vet contacts."
            count={data?.dogs.length}
            onClick={() => data && save("dogs-and-owners", dogDirectoryRows(data))}
          />
          <ExportRow
            title="Owners"
            blurb="One row per household, with dogs and balance."
            count={data?.owners.length}
            onClick={() =>
              data &&
              save(
                "owners",
                data.owners.map((o) => {
                  const acct = accounts.find((a) => a.phone === o.phone);
                  return {
                    ...o,
                    dogs: data.dogs
                      .filter((d) => d.phone === o.phone)
                      .map((d) => d.dog_name)
                      .join("; "),
                    outstanding: acct?.outstanding ?? 0,
                    charged: acct?.charged ?? 0,
                    paid: acct?.paid ?? 0,
                  };
                })
              )
            }
          />
          <ExportRow
            title="Visits"
            blurb="Every sign-in and sign-out with service, add-ons, who handed over and price."
            count={data?.signins.length}
            onClick={() => data && save("visits", data.signins as unknown as Record<string, unknown>[])}
          />
          <ExportRow
            title="Boarding reservations"
            blurb="Dates, add-ons, walks per day, feeding and medication instructions."
            count={data?.boardings.length}
            onClick={() => data && save("boardings", data.boardings as unknown as Record<string, unknown>[])}
          />
          <ExportRow
            title="Packages"
            blurb="Blocks sold, kind, days used against days bought and price."
            count={data?.packages.length}
            onClick={() => data && save("packages", data.packages as unknown as Record<string, unknown>[])}
          />
          <ExportRow
            title="Walk logs"
            blurb="Per dog, per day, per slot — out, back and who walked."
            count={data?.walkLogs.length}
            onClick={() => data && save("walk-logs", data.walkLogs as unknown as Record<string, unknown>[])}
          />
          <ExportRow
            title="Vaccinations"
            blurb="Every record with given and expiry dates."
            count={data?.vaccinations.length}
            onClick={() =>
              data && save("vaccinations", data.vaccinations as unknown as Record<string, unknown>[])
            }
          />
        </div>

        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          These files contain client names, phone numbers, addresses and emergency contacts. Treat a
          download like a printed client list — keep it off shared drives and delete it when the job
          is done.
        </p>
      </section>

      {error && <p className="text-xs font-medium text-rose-500">{error}</p>}
      {note && <p className="text-xs font-medium text-emerald-700">{note}</p>}
    </div>
  );
}

function ReportLink({ href, title, blurb }: { href: string; title: string; blurb: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5 transition hover:border-accent-300"
    >
      <p className="text-sm font-medium text-ink">{title} →</p>
      <p className="mt-0.5 text-[11px] leading-snug text-ink-3">{blurb}</p>
    </Link>
  );
}

function Stat({
  label,
  value,
  tone,
  small,
}: {
  label: string;
  value: string;
  tone?: "rose" | "emerald";
  small?: boolean;
}) {
  const colour =
    tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-700" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-ink-3">{label}</p>
      <p className={`${small ? "text-sm" : "text-lg"} font-semibold ${colour}`}>{value}</p>
    </div>
  );
}

function Download({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 hover:border-accent-300"
    >
      ⬇ {label}
    </button>
  );
}

function ExportRow({
  title,
  blurb,
  count,
  onClick,
}: {
  title: string;
  blurb: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-ink-3">{blurb}</p>
      </div>
      <button
        onClick={onClick}
        disabled={count === 0}
        className="shrink-0 rounded-xl bg-accent-500 px-3 py-1.5 text-xs font-medium text-accent-ink shadow-card hover:bg-accent-600 disabled:opacity-50"
      >
        ⬇ CSV
        {count != null && <span className="ml-1 opacity-80">({count.toLocaleString()})</span>}
      </button>
    </div>
  );
}
