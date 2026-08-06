"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { Package, SignInRecord } from "@/types";

const PASSCODE = process.env.NEXT_PUBLIC_RECORDS_PASSCODE;

interface MergedRow {
  key: string;
  dateKey: string;
  dog_name: string;
  last_name: string;
  drop_off_by: string;
  phone: string;
  drop_off_time?: string;
  pick_up_time?: string;
  service_type?: string;
  addons?: string[];
}

function localDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function mergeRecords(records: SignInRecord[]): MergedRow[] {
  const sorted = [...records].sort(
    (a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime()
  );
  const map = new Map<string, MergedRow>();
  for (const r of sorted) {
    if (!r.created_at) continue;
    const dateKey = localDateKey(r.created_at);
    const key = `${r.dog_name}|${r.phone}|${dateKey}`;
    let row = map.get(key);
    if (!row) {
      row = {
        key,
        dateKey,
        dog_name: r.dog_name,
        last_name: r.last_name,
        drop_off_by: r.drop_off_by,
        phone: r.phone,
      };
      map.set(key, row);
    }
    if (r.action === "drop_off") {
      row.drop_off_time = r.created_at;
      row.service_type = r.service_type;
      row.addons = r.addons;
    } else {
      row.pick_up_time = r.created_at;
      if (!row.service_type) row.service_type = r.service_type;
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.drop_off_time ?? b.pick_up_time ?? 0).getTime() - new Date(a.drop_off_time ?? a.pick_up_time ?? 0).getTime()
  );
}

function timeOnly(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function RecordsPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [entered, setEntered] = useState("");
  const [error, setError] = useState("");
  const [records, setRecords] = useState<SignInRecord[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });

  useEffect(() => {
    if (unlocked) loadAll();
  }, [unlocked]);

  async function loadAll() {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const [signinsRes, packagesRes] = await Promise.all([
        supabase.from("signins").select("*").order("created_at", { ascending: false }).limit(500),
        supabase.from("packages").select("*"),
      ]);
      if (signinsRes.error) throw signinsRes.error;
      if (packagesRes.error) throw packagesRes.error;
      setRecords((signinsRes.data as SignInRecord[]) ?? []);
      setPackages((packagesRes.data as Package[]) ?? []);
    } catch (e) {
      console.error("Loading records failed:", e);
      setError("Could not load records.");
    } finally {
      setLoading(false);
    }
  }

  // Latest package per phone number, looked up live — so a package added
  // after a dog's visit still shows up on that dog's row.
  const packageByPhone = useMemo(() => {
    const map = new Map<string, Package>();
    for (const p of packages) {
      if (!p.phone) continue;
      const existing = map.get(p.phone);
      if (!existing || new Date(p.created_at ?? 0) > new Date(existing.created_at ?? 0)) {
        map.set(p.phone, p);
      }
    }
    return map;
  }, [packages]);

  function checkPasscode() {
    if (entered === PASSCODE) {
      setUnlocked(true);
      setError("");
    } else {
      setError("Wrong passcode.");
    }
  }

  const merged = useMemo(() => mergeRecords(records), [records]);
  const filtered = useMemo(() => merged.filter((r) => r.dateKey === selectedDate), [merged, selectedDate]);

  const prettyDate = useMemo(() => {
    const [y, m, d] = selectedDate.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }, [selectedDate]);

  if (!unlocked) {
    return (
      <div className="mx-auto mt-28 flex max-w-xs flex-col gap-3 px-5">
        <h1 className="font-display text-xl font-semibold text-slate-900">Staff records</h1>
        <input
          type="password"
          value={entered}
          onChange={(e) => setEntered(e.target.value)}
          placeholder="Passcode"
          onKeyDown={(e) => e.key === "Enter" && checkPasscode()}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
        />
        <button
          onClick={checkPasscode}
          className="rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-medium text-white shadow-card hover:bg-accent-600"
        >
          Unlock
        </button>
        {error && <p className="text-xs font-medium text-rose-500">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 print:px-0 print:py-4">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="font-display text-xl font-semibold text-slate-900">Sign-in records</h1>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
          />
          <button
            onClick={() => window.print()}
            className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow-card hover:bg-accent-600"
          >
            🖨️ Print / Save as PDF
          </button>
        </div>
      </div>

      <div className="mb-4 hidden print:block">
        <h2 className="font-display text-lg font-semibold text-slate-900">Lombard Doggy Daycare — Sign-in list</h2>
        <p className="text-sm text-slate-500">{prettyDate}</p>
      </div>

      {loading && <p className="text-sm text-slate-500 print:hidden">Loading…</p>}
      {error && <p className="text-xs font-medium text-rose-500 print:hidden">{error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-card print:overflow-visible print:rounded-none print:border-0 print:shadow-none">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400 print:text-slate-600">
              <th className="px-4 py-3">Dog</th>
              <th className="px-4 py-3">Last name</th>
              <th className="px-4 py-3">Drop off by</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Drop off</th>
              <th className="px-4 py-3">Pick up</th>
              <th className="px-4 py-3">Service</th>
              <th className="px-4 py-3">Add-ons</th>
              <th className="px-4 py-3">Package</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const pkg = packageByPhone.get(r.phone);
              const left = pkg ? Math.max(0, pkg.total_days - pkg.days_used) : null;
              return (
                <tr key={r.key} className="border-b border-slate-50 last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">{r.dog_name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.last_name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.drop_off_by}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.phone}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{timeOnly(r.drop_off_time)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{timeOnly(r.pick_up_time)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.service_type ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                    {r.addons && r.addons.length ? r.addons.join(", ") : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                    {pkg ? `${left} of ${pkg.total_days} left` : "—"}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-sm text-slate-400">
                  No sign-ins for this date.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
