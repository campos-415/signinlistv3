"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { todayKey } from "@/lib/dates";
import { Category, DailyInput, computeDailyTotals, loadDailyData } from "@/lib/daily";
import StaffGate from "@/components/StaffGate";
import StaffNav from "@/components/StaffNav";
import DateField from "@/components/DateField";
import { useSettings } from "@/components/SettingsProvider";
import BarChart from "@/components/BarChart";

export default function DailyPage() {
  return (
    <StaffGate title="End-of-day report">
      <Daily />
    </StaffGate>
  );
}

function Daily() {
  const { settings } = useSettings();
  const business = settings.business;

  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState(todayKey());
  // Held whole rather than split into pieces and reassembled — the totals
  // depend on the date too, and rebuilding the object is how that got
  // dropped before.
  const [data, setData] = useState<DailyInput | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await loadDailyData(selectedDate));
    } catch (e) {
      console.error("Loading daily report failed:", e);
      setError("Could not load the daily report.");
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    load();
  }, [load]);

  // Drilling into a category opens that day's sign-in list, filtered to
  // the service it came from.
  function openService(category: Category) {
    if (!category.service) return;
    router.push(`/in-house?date=${selectedDate}&service=${category.service}`);
  }

  const totals = useMemo(
    () =>
      computeDailyTotals(
        data ?? {
          signins: [],
          boardings: [],
          packageUses: [],
          packagesSold: [],
          selectedDate,
        }
      ),
    [data, selectedDate]
  );
  const {
    revenue: categories,
    dogsByService,
    revenueTotal,
    chargedTotal,
    dropOffs,
    pickUps,
    packageDaysUsed,
    projectedRevenue,
    projectedCount,
    scheduledToArrive,
  } = totals;
  // const {
  //   revenue: categories,
  //   dogsByService,
  //   revenueTotal,
  //   chargedTotal,
  //   dropOffs,
  //   pickUps,
  //   packageDaysUsed,
  // } = totals;

  const prettyDate = useMemo(() => {
    const [y, m, d] = selectedDate.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }, [selectedDate]);

  const printedAt = useMemo(
    () => new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data]
  );

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 print:px-0 print:py-0">
      <style>{`
        @media print {
          @page { margin: 0.4in; size: portrait; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-header {
            background: linear-gradient(135deg, rgb(var(--print-from)) 0%, rgb(var(--print-to)) 100%);
            border-radius: 20px;
          }
          .print-footer { text-align: center; color: rgb(var(--print-ink)); font-size: 8px; margin-top: 10px; }
          section { break-inside: avoid; }
        }
      `}</style>

      <div className="print:hidden">
        <StaffNav current="/day-report" />
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="font-display text-xl font-semibold text-ink">
          End-of-day report
        </h1>
        <div className="flex items-center gap-2">
          <DateField
            value={selectedDate}
            onChange={setSelectedDate}
            wrapperClassName="w-40"
            className="rounded-xl border border-line bg-surface px-3.5 py-2 text-sm text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
            ariaLabel="Date"
          />
          <button
            onClick={() => window.print()}
            className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-accent-ink shadow-card hover:bg-accent-600">
            🖨️ Print / Save as PDF
          </button>
        </div>
      </div>

      <div className="print-header mb-5 hidden px-6 py-5 print:block">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-2xl font-bold text-white">
              🐾 {business.name}
            </h2>
            <p className="text-base font-medium text-white/90">
              End of day — {prettyDate}
            </p>
          </div>
          <div className="rounded-2xl bg-white/20 px-4 py-2 text-right text-xs font-medium text-white">
            <p>${revenueTotal.toFixed(2)} booked</p>
            <p className="text-white/80">Printed {printedAt}</p>
          </div>
        </div>
      </div>

      {loading && (
        <p className="text-sm text-ink-3 print:hidden">Loading…</p>
      )}
      {error && (
        <p className="text-xs font-medium text-rose-500 print:hidden">
          {error}
        </p>
      )}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Revenue" value={`$${revenueTotal.toFixed(2)}`} accent />
        <Stat label="Dropped off" value={String(dropOffs.length)} />
        <Stat label="Picked up" value={String(pickUps.length)} />
        <Stat label="Scheduled to arrive" value={String(scheduledToArrive)} />
      </div>

      {projectedCount > 0 && (
        <div className="mb-5 rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-800 print:hidden">
          <span className="font-medium">
            ${projectedRevenue.toFixed(2)} projected
          </span>{" "}
          from {projectedCount} dog{projectedCount === 1 ? "" : "s"} still
          boarding — not counted in revenue until pick-up.
        </div>
      )}

      <section className="mb-5 rounded-2xl border border-line bg-surface p-5 shadow-card">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">
          Revenue by category
        </h2>
        <BarChart
          data={categories}
          format={(n) => `$${n.toFixed(0)}`}
          onSelect={openService}
        />
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line-soft text-xs font-medium uppercase tracking-wide text-ink-3">
              <th className="py-2">Category</th>
              <th className="py-2 text-right">Count</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr
                key={c.key}
                className="border-b border-line-soft last:border-0">
                <td className="py-2 text-ink-2">
                  <span
                    className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                    style={{ backgroundColor: c.color }}
                  />
                  {c.service ? (
                    <button
                      onClick={() => openService(c)}
                      className="hover:text-accent-600 hover:underline print:no-underline">
                      {c.label}
                    </button>
                  ) : (
                    c.label
                  )}
                </td>
                <td className="py-2 text-right text-ink-3">{c.count}</td>
                <td className="py-2 text-right font-medium text-ink">
                  ${c.amount.toFixed(2)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-line">
              <td className="py-2 font-semibold text-ink">Total</td>
              <td />
              <td className="py-2 text-right font-semibold text-emerald-700">
                ${revenueTotal.toFixed(2)}
              </td>
            </tr>
          </tbody>
        </table>
        {Math.abs(chargedTotal - revenueTotal) > 0.01 && (
          <p className="mt-2 text-[11px] text-ink-3">
            Charged at pick-up today: ${chargedTotal.toFixed(2)}. A gap is normal — a package
            sale is revenue on the day it&apos;s sold but isn&apos;t charged to a visit, a boarding
            stay bills its whole total on the day the dog leaves, and staff can edit a price on
            /records.
          </p>
        )}
      </section>

      <section className="mb-5 rounded-2xl border border-line bg-surface p-5 shadow-card">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">
          Dogs by service
        </h2>
        <BarChart
          data={dogsByService}
          format={(n) => String(n)}
          onSelect={openService}
        />
        <p className="mt-2 text-[11px] text-ink-3 print:hidden">
          Tap a service to open that day&apos;s sign-in list.
        </p>
      </section>

      <p className="print-footer hidden print:block">
        🐾 That&apos;s a wrap for today! 🐾
      </p>
    </div>
  );
}


function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3 shadow-card">
      <p className="text-[11px] uppercase tracking-wide text-ink-3">{label}</p>
      <p className={`text-xl font-semibold ${accent ? "text-emerald-700" : "text-ink"}`}>
        {value}
      </p>
    </div>
  );
}
