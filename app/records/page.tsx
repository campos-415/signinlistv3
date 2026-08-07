"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { BATH_PRICES, estimatePrice, isFullDayVisit, PriceEstimate } from "@/lib/pricing";
import { AddonKey, ADDONS, BathSize, Package, ServiceType, SERVICE_TYPES, SignInRecord } from "@/types";

const PASSCODE = process.env.NEXT_PUBLIC_RECORDS_PASSCODE;
const BATH_SIZES: BathSize[] = ["S", "M", "L"];

interface MergedRow {
  key: string;
  dateKey: string;
  dog_name: string;
  last_name: string;
  drop_off_by: string;
  pick_up_by: string;
  phone: string;
  drop_off_id?: string; // most recent drop-off row — used for display/edit
  pick_up_id?: string; // most recent pick-up row — used for display/edit
  allIds: string[]; // every row (including duplicates) for this dog/day — used for delete
  drop_off_time?: string;
  pick_up_time?: string;
  service_type?: ServiceType;
  addons?: string[];
  bath_size?: BathSize | null;
  price?: number | null;
}

interface EditState {
  last_name: string;
  drop_off_by: string;
  pick_up_by: string;
  service_type: ServiceType;
  addons: AddonKey[];
  drop_off_time: string; // "HH:MM" 24h, input[type=time] format
  pick_up_time: string;
  price: string; // input value; parsed to number/null on save
  bath_size: BathSize | null;
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
        drop_off_by: "",
        pick_up_by: "",
        phone: r.phone,
        allIds: [],
      };
      map.set(key, row);
    }
    if (r.id) row.allIds.push(r.id);
    if (r.action === "drop_off") {
      row.drop_off_id = r.id;
      row.drop_off_time = r.created_at;
      row.drop_off_by = r.drop_off_by || row.drop_off_by;
      row.service_type = r.service_type;
      row.addons = r.addons;
      row.bath_size = r.bath_size ?? row.bath_size;
    } else {
      row.pick_up_id = r.id;
      row.pick_up_time = r.created_at;
      row.pick_up_by = r.pick_up_by || row.pick_up_by;
      row.price = r.price ?? row.price;
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

// "2026-08-06" + "15:04" -> ISO string for created_at, keeping the same
// calendar day the record is filed under.
function combineDateTime(dateKey: string, time: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  return new Date(y, m - 1, d, h, min).toISOString();
}

function isoToTimeInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [breakdownOpenKey, setBreakdownOpenKey] = useState<string | null>(null);

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

  // Packages looked up live per row — prefers a package tied to that
  // specific dog (dog_name set), falling back to a phone-only package
  // shared across every dog on that number (dog_name left blank).
  const packagesByPhone = useMemo(() => {
    const map = new Map<string, Package[]>();
    for (const p of packages) {
      if (!p.phone) continue;
      const list = map.get(p.phone) ?? [];
      list.push(p);
      map.set(p.phone, list);
    }
    return map;
  }, [packages]);

  function findPackage(phone: string, dogName: string): Package | null {
    const candidates = packagesByPhone.get(phone) ?? [];
    const byDog = candidates
      .filter((p) => p.dog_name && p.dog_name.trim().toLowerCase() === dogName.trim().toLowerCase())
      .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
    if (byDog.length) return byDog[0];
    const shared = candidates
      .filter((p) => !p.dog_name)
      .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
    return shared[0] ?? null;
  }

  function checkPasscode() {
    if (entered === PASSCODE) {
      setUnlocked(true);
      setError("");
    } else {
      setError("Wrong passcode.");
    }
  }

  // A price estimate for the visit — live (using the current time as a
  // stand-in pick-up) if the dog hasn't been picked up yet, or
  // reconstructed from the actual recorded times once it has. A package
  // only ever covers a FULL daycare day, decided against whichever
  // pick-up time is used here.
  function computeEstimate(r: MergedRow, pkg: Package | null): PriceEstimate | null {
    if (!r.drop_off_time || !r.service_type) return null;
    const dropOff = new Date(r.drop_off_time);
    const pickUp = r.pick_up_time ? new Date(r.pick_up_time) : new Date();
    const usingPackage = !!pkg && r.service_type === "daycare" && isFullDayVisit(dropOff, pickUp);
    return estimatePrice(r.service_type, dropOff, pickUp, r.addons ?? [], usingPackage, r.bath_size ?? null);
  }

  const merged = useMemo(() => mergeRecords(records), [records]);
  const SERVICE_ORDER: Record<string, number> = { daycare: 0, boarding: 1, meet_greet: 2 };
  const filtered = useMemo(() => {
    return merged
      .filter((r) => r.dateKey === selectedDate)
      .sort((a, b) => {
        const orderA = SERVICE_ORDER[a.service_type ?? ""] ?? 99;
        const orderB = SERVICE_ORDER[b.service_type ?? ""] ?? 99;
        if (orderA !== orderB) return orderA - orderB;
        return 0; // stable sort keeps merged's existing recency order within the group
      });
  }, [merged, selectedDate]);

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
    [filtered] // eslint-disable-line react-hooks/exhaustive-deps
  );

  function startEdit(row: MergedRow) {
    setEditingKey(row.key);
    setEditState({
      last_name: row.last_name,
      drop_off_by: row.drop_off_by,
      pick_up_by: row.pick_up_by,
      service_type: row.service_type ?? "daycare",
      addons: (row.addons as AddonKey[]) ?? [],
      drop_off_time: isoToTimeInput(row.drop_off_time),
      pick_up_time: isoToTimeInput(row.pick_up_time),
      price: row.price != null ? String(row.price) : "",
      bath_size: row.bath_size ?? null,
    });
  }

  function cancelEdit() {
    setEditingKey(null);
    setEditState(null);
  }

  function toggleEditAddon(key: AddonKey) {
    setEditState((prev) =>
      prev
        ? { ...prev, addons: prev.addons.includes(key) ? prev.addons.filter((a) => a !== key) : [...prev.addons, key] }
        : prev
    );
  }

  // Clicking a bath size sets/toggles it and adjusts the price field by
  // swapping out any previously-applied bath amount for the new one —
  // clicking the same size again removes the bath charge entirely. The
  // price field stays freely editable afterward for further adjustments.
  function selectBathSize(size: BathSize) {
    setEditState((prev) => {
      if (!prev) return prev;
      const oldAmount = prev.bath_size ? BATH_PRICES[prev.bath_size] : 0;
      const turningOff = prev.bath_size === size;
      const newAmount = turningOff ? 0 : BATH_PRICES[size];
      const currentPrice = parseFloat(prev.price) || 0;
      const updatedPrice = Math.max(0, currentPrice - oldAmount + newAmount);
      return { ...prev, bath_size: turningOff ? null : size, price: updatedPrice.toFixed(2) };
    });
  }

  async function saveEdit(row: MergedRow) {
    if (!editState) return;
    setSavingEdit(true);
    setError("");
    try {
      const supabase = getSupabase();

      if (row.drop_off_id) {
        const { error: err } = await supabase
          .from("signins")
          .update({
            last_name: editState.last_name.trim(),
            drop_off_by: editState.drop_off_by.trim(),
            service_type: editState.service_type,
            addons: editState.addons,
            bath_size: editState.addons.includes("bath") ? editState.bath_size : null,
            created_at: editState.drop_off_time
              ? combineDateTime(row.dateKey, editState.drop_off_time)
              : row.drop_off_time,
          })
          .eq("id", row.drop_off_id);
        if (err) throw err;
      }
      if (row.pick_up_id) {
        const parsedPrice = editState.price.trim() === "" ? null : parseFloat(editState.price);
        const { error: err } = await supabase
          .from("signins")
          .update({
            last_name: editState.last_name.trim(),
            pick_up_by: editState.pick_up_by.trim(),
            service_type: editState.service_type,
            price: parsedPrice !== null && !Number.isNaN(parsedPrice) ? parsedPrice : null,
            created_at: editState.pick_up_time
              ? combineDateTime(row.dateKey, editState.pick_up_time)
              : row.pick_up_time,
          })
          .eq("id", row.pick_up_id);
        if (err) throw err;
      }

      cancelEdit();
      loadAll();
    } catch (e) {
      console.error("Saving edit failed:", e);
      setError("Could not save changes.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteRow(row: MergedRow) {
    const label = `${row.dog_name}'s visit on ${row.dateKey}`;
    const extra = row.allIds.length > 2 ? " (including some duplicate sign-ins found for this day)" : "";
    if (
      !window.confirm(`Delete ${label}?${extra} This removes the entire entry and can't be undone.`)
    ) {
      return;
    }
    setDeletingKey(row.key);
    setError("");
    try {
      const supabase = getSupabase();
      if (row.allIds.length) {
        const { error: err } = await supabase.from("signins").delete().in("id", row.allIds);
        if (err) throw err;
      }
      loadAll();
    } catch (e) {
      console.error("Deleting record failed:", e);
      setError("Could not delete this record.");
    } finally {
      setDeletingKey(null);
    }
  }

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
    <div className="mx-auto max-w-6xl px-6 py-10 print:px-0 print:py-0">
      <style>{`
        @media print {
          @page { margin: 0.4in; size: portrait; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          table { font-size: 6px; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; }
          .print-header {
            background: linear-gradient(135deg, #f59e0b 0%, #f97316 100%);
            border-radius: 20px;
            position: relative;
            overflow: hidden;
          }
          .print-paw {
            position: absolute;
            font-size: 48px;
            opacity: 0.15;
            transform: rotate(-15deg);
          }
          tbody tr:nth-child(even) td { background: #fff7ed; }
          .print-footer {
            text-align: center;
            color: #b45309;
            font-size: 8px;
            margin-top: 10px;
          }
        }
      `}</style>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="font-display text-xl font-semibold text-slate-900">
          Sign-in records
        </h1>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
          />
          <button
            onClick={() => window.print()}
            className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow-card hover:bg-accent-600">
            🖨️ Print / Save as PDF
          </button>
        </div>
      </div>

      <div className="print-header mb-5 hidden px-6 py-5 print:block">
        <span className="print-paw" style={{ top: -10, right: 30 }}>
          🐾
        </span>
        <span className="print-paw" style={{ bottom: -20, left: "40%" }}>
          🐾
        </span>
        <div className="relative flex items-center justify-between">
          <div>
            <h2 className="font-display text-2xl font-bold text-white">
              🐾 Lombard Doggy Daycare
            </h2>
            <p className="text-base font-medium text-white/90">
              Sign-in list — {prettyDate}
            </p>
          </div>
          <div className="rounded-2xl bg-white/20 px-4 py-2 text-right text-xs font-medium text-white">
            <p>
              {filtered.length} dog{filtered.length === 1 ? "" : "s"} today
            </p>
            <p className="text-white/80">Printed {printedAt}</p>
          </div>
        </div>
      </div>

      {loading && (
        <p className="text-sm text-slate-500 print:hidden">Loading…</p>
      )}
      {error && (
        <p className="text-xs font-medium text-rose-500 print:hidden">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-card print:overflow-visible print:rounded-2xl print:border print:border-amber-200 print:shadow-none">
        <table className="w-full text-left text-sm print:border-collapse">
          <thead>
            <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400 print:border-b-2 print:border-amber-300 print:bg-amber-100 print:text-amber-900">
              <th className="px-4 py-3 print:border print:border-amber-200 print:px-2 print:py-1.5">
                🐕 Dog
              </th>
              <th className="px-4 py-3 print:border print:border-amber-200 print:px-2 print:py-1.5">
                Last name
              </th>
              <th className="px-4 py-3 print:border print:border-amber-200 print:px-2 print:py-1.5">
                Phone
              </th>
              <th className="px-4 py-3 print:border print:border-amber-200 print:px-2 print:py-1.5">
                Drop off by
              </th>
              <th className="px-4 py-3 print:border print:border-amber-200 print:px-2 print:py-1.5">
                Drop off
              </th>
              <th className="px-4 py-3 print:border print:border-amber-200 print:px-2 print:py-1.5">
                Picked up by
              </th>
              <th className="px-4 py-3 print:border print:border-amber-200 print:px-2 print:py-1.5">
                Pick up
              </th>
              <th className="px-4 py-3 print:border print:border-amber-200 print:px-2 print:py-1.5">
                Add-ons
              </th>
              <th className="px-4 py-3 print:border print:border-amber-200 print:px-2 print:py-1.5">
                Package
              </th>
              <th className="px-4 py-3 print:border print:border-amber-200 print:px-2 print:py-1.5">
                Price
              </th>
              <th className="px-4 py-3 print:hidden">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const pkg = findPackage(r.phone, r.dog_name);
              const left = pkg
                ? Math.max(0, pkg.total_days - pkg.days_used)
                : null;
              const isEditing = editingKey === r.key;
              const showGroupHeader =
                i === 0 || r.service_type !== filtered[i - 1].service_type;
              const groupInfo = SERVICE_TYPES.find(
                (s) => s.key === r.service_type,
              );
              const groupHeader = showGroupHeader && (
                <tr key={`${r.key}-group`}>
                  <td
                    colSpan={12}
                    className="bg-slate-100 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 print:border print:border-amber-200 print:bg-amber-50 print:px-2 print:text-amber-900">
                    {groupInfo
                      ? `${groupInfo.icon} ${groupInfo.label}`
                      : "Other"}
                  </td>
                </tr>
              );

              if (isEditing && editState) {
                return (
                  <Fragment key={r.key}>
                    {groupHeader}
                    <tr className="border-b border-slate-100 bg-accent-50/40 align-top print:hidden">
                      <td className="px-4 py-3 font-medium text-slate-800">
                        {r.dog_name}
                      </td>
                      <td className="px-4 py-3">
                        <input
                          value={editState.last_name}
                          onChange={(e) =>
                            setEditState({
                              ...editState,
                              last_name: e.target.value,
                            })
                          }
                          className="w-28 rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-accent-500"
                        />
                      </td>
                      <td className="px-4 py-3 text-slate-500">{r.phone}</td>
                      <td className="px-4 py-3">
                        <input
                          value={editState.drop_off_by}
                          onChange={(e) =>
                            setEditState({
                              ...editState,
                              drop_off_by: e.target.value,
                            })
                          }
                          className="w-28 rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-accent-500"
                        />
                      </td>

                      <td className="px-4 py-3">
                        {r.drop_off_id ? (
                          <input
                            type="time"
                            value={editState.drop_off_time}
                            onChange={(e) =>
                              setEditState({
                                ...editState,
                                drop_off_time: e.target.value,
                              })
                            }
                            className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-accent-500"
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <input
                          value={editState.pick_up_by}
                          onChange={(e) =>
                            setEditState({
                              ...editState,
                              pick_up_by: e.target.value,
                            })
                          }
                          className="w-28 rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-accent-500"
                        />
                      </td>
                      <td className="px-4 py-3">
                        {r.pick_up_id ? (
                          <input
                            type="time"
                            value={editState.pick_up_time}
                            onChange={(e) =>
                              setEditState({
                                ...editState,
                                pick_up_time: e.target.value,
                              })
                            }
                            className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-accent-500"
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {ADDONS.map((a) => (
                            <button
                              key={a.key}
                              onClick={() => toggleEditAddon(a.key)}
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
                                editState.addons.includes(a.key)
                                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                                  : "border-slate-200 bg-white text-slate-500"
                              }`}>
                              {a.label}
                            </button>
                          ))}
                        </div>
                        {editState.addons.includes("bath") && (
                          <div className="mt-1.5 flex items-center gap-1">
                            <span className="text-[10px] text-slate-400">
                              Bath size:
                            </span>
                            {BATH_SIZES.map((size) => (
                              <button
                                key={size}
                                onClick={() => selectBathSize(size)}
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
                                  editState.bath_size === size
                                    ? "border-sky-500 bg-sky-50 text-sky-700"
                                    : "border-slate-200 bg-white text-slate-500"
                                }`}>
                                {size} ${BATH_PRICES[size]}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {pkg ? `${left} of ${pkg.total_days} left` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {r.pick_up_id ? (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={editState.price}
                            onChange={(e) =>
                              setEditState({
                                ...editState,
                                price: e.target.value,
                              })
                            }
                            placeholder="0.00"
                            className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-accent-500"
                          />
                        ) : (
                          (() => {
                            const liveEstimate = computeEstimate(r, pkg);
                            return liveEstimate ? (
                              <span
                                className="text-xs text-slate-400"
                                title="Live estimate — finalizes at pick-up">
                                ~${liveEstimate.amount.toFixed(2)}
                              </span>
                            ) : (
                              <span
                                className="text-xs text-slate-400"
                                title="Set once this visit has a pick-up">
                                —
                              </span>
                            );
                          })()
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => saveEdit(r)}
                            disabled={savingEdit}
                            className="rounded-lg bg-accent-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-600 disabled:opacity-60">
                            {savingEdit ? "Saving…" : "Save"}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:border-slate-300">
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              }

              return (
                <Fragment key={r.key}>
                  {groupHeader}
                  <tr className="border-b border-slate-50 last:border-0 print:border-b-0">
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800 print:border print:border-amber-100 print:px-2 print:py-1.5">
                      {r.dog_name}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600 print:border print:border-amber-100 print:px-2 print:py-1.5">
                      {r.last_name}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600 print:border print:border-amber-100 print:px-2 print:py-1.5">
                      {r.phone}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600 print:border print:border-amber-100 print:px-2 print:py-1.5">
                      {r.drop_off_by || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600 print:border print:border-amber-100 print:px-2 print:py-1.5">
                      {timeOnly(r.drop_off_time)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600 print:border print:border-amber-100 print:px-2 print:py-1.5">
                      {r.pick_up_by || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600 print:border print:border-amber-100 print:px-2 print:py-1.5">
                      {timeOnly(r.pick_up_time)}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-slate-600 print:border print:border-amber-100 print:px-2 print:py-1.5">
                      {r.addons && r.addons.length
                        ? r.addons
                            .map((a) =>
                              a === "bath" && r.bath_size
                                ? `Bath (${r.bath_size})`
                                : a === "bath"
                                  ? "Bath"
                                  : a,
                            )
                            .join(", ")
                        : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600 print:border print:border-amber-100 print:px-2 print:py-1.5">
                      {pkg ? `${left} / ${pkg.total_days}` : "—"}
                    </td>
                    <td className="px-4 py-3 font-medium text-emerald-700 print:border print:border-amber-100 print:px-2 print:py-1.5 align-top">
                      {(() => {
                        const estimate = computeEstimate(r, pkg);
                        if (!estimate)
                          return <span className="text-slate-400">—</span>;
                        const finalAmount =
                          r.price != null ? r.price : estimate.amount;
                        const isFinal = r.price != null;
                        const showBreakdown = breakdownOpenKey === r.key;
                        return (
                          <div>
                            <button
                              onClick={() =>
                                setBreakdownOpenKey(
                                  showBreakdown ? null : r.key,
                                )
                              }
                              className="inline-flex items-center gap-1 hover:underline ">
                              ${finalAmount.toFixed(2)}
                              {!isFinal && (
                                <span className="text-[10px] font-normal text-slate-400 print:hidden">
                                  (est.)
                                </span>
                              )}
                              <span className="text-slate-400 print:hidden">🧾</span>
                            </button>
                            {showBreakdown && (
                              <ul className="mt-1 space-y-0.5 text-[10px] font-normal text-slate-500">
                                {estimate.breakdown.map((item, i) => (
                                  <li
                                    key={i}
                                    className="flex justify-between gap-3">
                                    <span>{item.label}</span>
                                    <span>${item.amount.toFixed(2)}</span>
                                  </li>
                                ))}
                                {isFinal &&
                                  Math.abs(finalAmount - estimate.amount) >
                                    0.01 && (
                                    <li className="pt-0.5 text-slate-400">
                                      (price manually adjusted)
                                    </li>
                                  )}
                              </ul>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 print:hidden">
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => startEdit(r)}
                          className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-slate-300">
                          Edit
                        </button>
                        <button
                          onClick={() => deleteRow(r)}
                          disabled={deletingKey === r.key}
                          className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs text-rose-500 hover:border-rose-300 disabled:opacity-60">
                          {deletingKey === r.key ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
            {filtered.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={12}
                  className="px-4 py-6 text-center text-sm text-slate-400 print:border print:border-amber-100">
                  No sign-ins for this date.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="print-footer hidden print:block">
        🐾 Thanks for a pawsome day! 🐾
      </p>
    </div>
  );
}
