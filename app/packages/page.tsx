"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { formatPhoneInput } from "@/lib/phone";
import { Package } from "@/types";
import { isStaffUnlocked, markStaffUnlocked } from "@/lib/staffAuth";
import StaffNav from "@/components/StaffNav";

const PASSCODE = process.env.NEXT_PUBLIC_RECORDS_PASSCODE;

export default function PackagesPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [entered, setEntered] = useState("");
  const [error, setError] = useState("");
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const [name, setName] = useState("");
  const [dogName, setDogName] = useState("");
  const [phone, setPhone] = useState("");
  const [days, setDays] = useState(10);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTotal, setEditTotal] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (isStaffUnlocked()) setUnlocked(true);
  }, []);

  useEffect(() => {
    if (unlocked) load();
  }, [unlocked]);

  async function load() {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data, error: err } = await supabase
        .from("packages")
        .select("*")
        .order("created_at", { ascending: false });
      if (err) throw err;
      setPackages((data as Package[]) ?? []);
    } catch (e) {
      console.error("Loading packages failed:", e);
      setError("Could not load packages.");
    } finally {
      setLoading(false);
    }
  }

  function checkPasscode() {
    if (entered === PASSCODE) {
      markStaffUnlocked();
      setUnlocked(true);
      setError("");
    } else {
      setError("Wrong passcode.");
    }
  }

  async function addPackage() {
    if (!name.trim() || !phone.trim() || days < 1) {
      setError("Fill in client name, phone, and number of days.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase.from("packages").insert({
        client_name: name.trim(),
        dog_name: dogName.trim() || null,
        phone: phone.trim(),
        total_days: days,
        days_used: 0,
      });
      if (err) throw err;
      setName("");
      setDogName("");
      setPhone("");
      setDays(10);
      load();
    } catch (e) {
      console.error("Adding package failed:", e);
      setError("Could not save the package.");
    } finally {
      setSaving(false);
    }
  }

  async function adjustUsed(pkg: Package, delta: number) {
    if (!pkg.id) return;
    const next = Math.max(0, Math.min(pkg.total_days, pkg.days_used + delta));
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase.from("packages").update({ days_used: next }).eq("id", pkg.id);
      if (err) throw err;
      load();
    } catch (e) {
      console.error("Updating package failed:", e);
    }
  }

  function startEditTotal(pkg: Package) {
    setEditingId(pkg.id ?? null);
    setEditTotal(pkg.total_days);
  }

  async function saveEditTotal(pkg: Package) {
    if (!pkg.id) return;
    const nextTotal = Math.max(1, editTotal);
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase
        .from("packages")
        .update({ total_days: nextTotal, days_used: Math.min(pkg.days_used, nextTotal) })
        .eq("id", pkg.id);
      if (err) throw err;
      setEditingId(null);
      load();
    } catch (e) {
      console.error("Updating package total failed:", e);
    }
  }

  async function deletePackage(pkg: Package) {
    if (!pkg.id) return;
    const label = pkg.dog_name ? `${pkg.client_name} · ${pkg.dog_name}` : pkg.client_name;
    if (!window.confirm(`Delete the package for ${label}? This can't be undone.`)) return;
    setDeletingId(pkg.id);
    setError("");
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase.from("packages").delete().eq("id", pkg.id);
      if (err) throw err;
      load();
    } catch (e) {
      console.error("Deleting package failed:", e);
      setError("Could not delete the package.");
    } finally {
      setDeletingId(null);
    }
  }

  const filteredPackages = useMemo(() => {
    const digits = search.replace(/\D/g, "");
    if (!digits) return packages;
    return packages.filter((p) => p.phone.replace(/\D/g, "").includes(digits));
  }, [packages, search]);

  if (!unlocked) {
    return (
      <div className="mx-auto mt-28 flex max-w-xs flex-col gap-3 px-5">
        <h1 className="font-display text-xl font-semibold text-slate-900">Staff packages</h1>
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
    <div className="mx-auto max-w-3xl px-6 py-10">
      <StaffNav current="/packages" />
      <h1 className="font-display mb-6 text-xl font-semibold text-slate-900">Daycare packages</h1>

      <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
        <p className="mb-4 text-sm font-medium text-slate-700">Add a new package</p>
        <p className="mb-1 text-xs text-slate-400">
          Leave dog name blank for a package shared across every dog on that phone number.
        </p>
        <div className="grid gap-3 sm:grid-cols-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Client name"
            className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
          />
          <input
            value={dogName}
            onChange={(e) => setDogName(e.target.value)}
            placeholder="Dog name (optional)"
            className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
            placeholder="Phone (matches kiosk phone field)"
            inputMode="numeric"
            className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
          />
          <input
            type="number"
            min={1}
            value={days}
            onChange={(e) => setDays(Math.max(1, parseInt(e.target.value) || 1))}
            placeholder="Days"
            className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
          />
        </div>
        <button
          onClick={addPackage}
          disabled={saving}
          className="mt-4 rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-medium text-white shadow-card hover:bg-accent-600 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Add package"}
        </button>
        {error && <p className="mt-3 text-xs font-medium text-rose-500">{error}</p>}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(formatPhoneInput(e.target.value))}
              placeholder="Search by phone number…"
              inputMode="numeric"
              className="w-full max-w-xs rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
            />
            {search && (
              <span className="whitespace-nowrap text-xs text-slate-400">
                {filteredPackages.length} of {packages.length}
              </span>
            )}
          </div>
          <div className="space-y-2">
            {filteredPackages.map((p) => {
            const left = p.total_days - p.days_used;
            return (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-3.5 shadow-card">
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {p.client_name}
                    {p.dog_name && (
                      <span className="font-normal text-slate-500">
                        {" "}
                        · {p.dog_name}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">{p.phone}</p>
                </div>
                <div className="flex items-center gap-3">
                  <>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        left <= 0
                          ? "bg-rose-50 text-rose-600"
                          : "bg-accent-50 text-accent-700"
                      }`}>
                      {left} of {p.total_days} left
                    </span>
                    <button
                      onClick={() => adjustUsed(p, -1)}
                      className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-slate-300"
                      title="Use a day manually">
                      ➕
                    </button>
                    <button
                      onClick={() => adjustUsed(p, 1)}
                      className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-slate-300"
                      title="Undo a day">
                      ➖
                    </button>
                    <button
                      onClick={() => deletePackage(p)}
                      disabled={deletingId === p.id}
                      className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs text-rose-500 hover:border-rose-300 disabled:opacity-60"
                      title="Delete this package">
                      {deletingId === p.id ? "Deleting…" : "Delete"}
                    </button>
                  </>
                </div>
              </div>
            );
          })}
          {filteredPackages.length === 0 && packages.length > 0 && (
            <p className="text-sm text-slate-400">No packages match that phone number.</p>
          )}
          {packages.length === 0 && <p className="text-sm text-slate-400">No packages yet.</p>}
          </div>
        </>
      )}
    </div>
  );
}
