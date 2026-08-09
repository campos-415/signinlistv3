"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { formatPhoneInput } from "@/lib/phone";
import { daysLeft, findClient } from "@/lib/clients";
import { prettyDateKey, todayKey } from "@/lib/dates";
import { PRICING } from "@/lib/pricing";
import { Client, Package, PackageUse } from "@/types";
import { useSettings } from "@/components/SettingsProvider";
import StaffGate from "@/components/StaffGate";
import StaffNav from "@/components/StaffNav";
import DogLink from "@/components/DogLink";

export default function PackagesPage() {
  return (
    <StaffGate title="Staff packages">
      <Packages />
    </StaffGate>
  );
}

function Packages() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [uses, setUses] = useState<PackageUse[]>([]);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  // New-package form: look the number up, then pick which dogs it's for.
  const [phone, setPhone] = useState("");
  const { settings } = useSettings();
  const tiers = settings.packageTiers;
  const [days, setDays] = useState(10);
  // What the client paid. Kept as a string so the field can start empty
  // rather than showing a misleading 0.
  const [price, setPrice] = useState("");
  // True when staff are entering a one-off outside the configured tiers.
  const [custom, setCustom] = useState(false);

  // Preselect the first tier once settings land, so the common case is one
  // tap — but never stomp on a choice already made.
  const seededTier = useRef(false);
  useEffect(() => {
    if (seededTier.current || custom || !tiers.length) return;
    seededTier.current = true;
    setDays(tiers[0].days);
    setPrice(String(tiers[0].price));
  }, [tiers, custom]);
  const [clientMatches, setClientMatches] = useState<Client[]>([]);
  const [clientLoading, setClientLoading] = useState(false);
  const [clientChecked, setClientChecked] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // A shared package has no dog_name, so it covers every dog on the number.
  const [shared, setShared] = useState(false);
  const [saving, setSaving] = useState(false);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTotal, setEditTotal] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const [pkgRes, useRes, clientRes] = await Promise.all([
        supabase.from("packages").select("*").order("created_at", { ascending: false }),
        supabase.from("package_uses").select("*").order("used_on", { ascending: false }).limit(1000),
        supabase.from("clients").select("*"),
      ]);
      if (pkgRes.error) throw pkgRes.error;
      if (useRes.error) throw useRes.error;
      if (clientRes.error) throw clientRes.error;
      setPackages((pkgRes.data as Package[]) ?? []);
      setUses((useRes.data as PackageUse[]) ?? []);
      setAllClients((clientRes.data as Client[]) ?? []);
    } catch (e) {
      console.error("Loading packages failed:", e);
      setError("Could not load packages.");
    } finally {
      setLoading(false);
    }
  }

  // Same debounced phone lookup the boarding page uses, so staff never
  // retype a client's name to sell them a package.
  useEffect(() => {
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    setSelectedIds([]);
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7) {
      setClientMatches([]);
      setClientChecked(false);
      return;
    }
    lookupTimer.current = setTimeout(async () => {
      setClientLoading(true);
      try {
        const supabase = getSupabase();
        const { data, error: err } = await supabase
          .from("clients")
          .select("*")
          .eq("phone", phone.trim())
          .order("created_at", { ascending: true });
        if (err) throw err;
        const found = (data as Client[]) ?? [];
        setClientMatches(found);
        if (found.length === 1 && found[0].id) setSelectedIds([found[0].id]);
      } catch (e) {
        console.error("Client lookup failed:", e);
      } finally {
        setClientLoading(false);
        setClientChecked(true);
      }
    }, 400);
  }, [phone]);

  const selectedDogs = clientMatches.filter((c) => c.id && selectedIds.includes(c.id));

  function toggleDog(id?: string) {
    if (!id) return;
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function addPackages() {
    if (!phone.trim() || days < 1) {
      setError("Enter a phone number and how many days the package covers.");
      return;
    }
    if (!shared && selectedDogs.length === 0) {
      setError("Pick which dog (or dogs) this package is for — or mark it shared.");
      return;
    }
    const parsedPrice = price.trim() === "" ? null : parseFloat(price);
    if (parsedPrice === null || Number.isNaN(parsedPrice) || parsedPrice < 0) {
      setError("Enter what the client paid for the package — that's the day's revenue for it.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const supabase = getSupabase();
      // The owner surname on file is the closest thing to a client name;
      // it's only used as a label on the list.
      const clientName = clientMatches[0]?.last_name?.trim() || phone.trim();
      const rows: {
        client_name: string;
        dog_name: string | null;
        phone: string;
        total_days: number;
        days_used: number;
        price: number;
      }[] = shared
        ? [
            {
              client_name: clientName,
              dog_name: null,
              phone: phone.trim(),
              total_days: days,
              days_used: 0,
              price: parsedPrice,
            },
          ]
        : selectedDogs.map((d) => ({
            client_name: d.last_name?.trim() || clientName,
            dog_name: d.dog_name,
            phone: phone.trim(),
            total_days: days,
            days_used: 0,
            // Price is per package, so two dogs each getting their own
            // package is two sales at this amount.
            price: parsedPrice,
          }));
      const { error: err } = await supabase.from("packages").insert(rows);
      if (err) throw err;
      setPhone("");
      // Back to the default tier rather than a hardcoded 10 days, so the
      // next sale starts from the configured price list.
      setCustom(false);
      setDays(tiers[0]?.days ?? 10);
      setPrice(tiers[0] ? String(tiers[0].price) : "");
      setSelectedIds([]);
      setShared(false);
      setClientMatches([]);
      setClientChecked(false);
      load();
    } catch (e) {
      console.error("Adding package failed:", e);
      setError("Could not save the package.");
    } finally {
      setSaving(false);
    }
  }

  // `delta` is how many days to CONSUME — negative gives one back.
  async function adjustUsed(pkg: Package, delta: number) {
    if (!pkg.id) return;
    const next = Math.max(0, Math.min(pkg.total_days, pkg.days_used + delta));
    if (next === pkg.days_used) return;
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase.from("packages").update({ days_used: next }).eq("id", pkg.id);
      if (err) throw err;

      // Keep the ledger in step with the counter so the history stays honest.
      if (delta > 0) {
        await supabase.from("package_uses").insert({
          package_id: pkg.id,
          dog_name: pkg.dog_name ?? null,
          used_on: todayKey(),
        });
      } else {
        const newest = uses
          .filter((u) => u.package_id === pkg.id)
          .sort((a, b) => b.used_on.localeCompare(a.used_on))[0];
        if (newest?.id) await supabase.from("package_uses").delete().eq("id", newest.id);
      }
      load();
    } catch (e) {
      console.error("Updating package failed:", e);
      setError("Could not update that package.");
    }
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
      setError("Could not update that package.");
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

  const usesByPackage = useMemo(() => {
    const map = new Map<string, PackageUse[]>();
    for (const u of uses) {
      const list = map.get(u.package_id) ?? [];
      list.push(u);
      map.set(u.package_id, list);
    }
    return map;
  }, [uses]);

  const filteredPackages = useMemo(() => {
    const digits = search.replace(/\D/g, "");
    if (!digits) return packages;
    return packages.filter((p) => p.phone.replace(/\D/g, "").includes(digits));
  }, [packages, search]);

  const active = filteredPackages.filter((p) => daysLeft(p) > 0);
  const usedUp = filteredPackages.filter((p) => daysLeft(p) <= 0);

  const rowProps = {
    allClients,
    usesByPackage,
    historyOpenId,
    setHistoryOpenId,
    editingId,
    setEditingId,
    editTotal,
    setEditTotal,
    saveEditTotal,
    adjustUsed,
    deletePackage,
    deletingId,
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <StaffNav current="/packages" />
      <h1 className="font-display mb-6 text-xl font-semibold text-slate-900">Daycare packages</h1>

      {/* New package */}
      <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
        <p className="mb-4 text-sm font-medium text-slate-700">Sell a package</p>

        <div className="max-w-xs">
          <label className="mb-1 block text-[11px] text-slate-400">Phone number</label>
          <input
            value={phone}
            onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
            placeholder="(123) 456-7890"
            inputMode="numeric"
            className={inputClass}
          />
        </div>

        {/* Tiers come from /settings, so the price list is set once rather
            than retyped per sale. Custom covers the odd one-off. */}
        <div className="mt-3">
          <label className="mb-1 block text-[11px] text-slate-400">Package</label>
          <div className="flex flex-wrap gap-2">
            {tiers.map((t) => {
              const active = !custom && days === t.days && price === String(t.price);
              return (
                <button
                  key={t.days}
                  type="button"
                  onClick={() => {
                    setCustom(false);
                    setDays(t.days);
                    setPrice(String(t.price));
                  }}
                  className={`rounded-2xl border px-4 py-2.5 text-left transition ${
                    active
                      ? "border-accent-500 bg-accent-50"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <span
                    className={`block text-sm font-medium ${active ? "text-accent-800" : "text-slate-700"}`}
                  >
                    {t.days} days
                  </span>
                  <span className="block text-xs text-emerald-700">${t.price.toFixed(2)}</span>
                  <span className="block text-[10px] text-slate-400">
                    ${(t.price / t.days).toFixed(2)}/day
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setCustom(true)}
              className={`rounded-2xl border px-4 py-2.5 text-sm font-medium transition ${
                custom
                  ? "border-accent-500 bg-accent-50 text-accent-800"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
              }`}
            >
              Custom…
            </button>
          </div>
          {tiers.length === 0 && (
            <p className="mt-1.5 text-[11px] text-amber-700">
              No package tiers configured yet —{" "}
              <Link href="/settings" className="font-medium text-accent-600 hover:underline">
                add them in Settings
              </Link>
              .
            </p>
          )}
        </div>

        {custom && (
          <div className="mt-3 grid max-w-md gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] text-slate-400">Days</label>
              <input
                type="number"
                min={1}
                value={days}
                onChange={(e) => setDays(Math.max(1, parseInt(e.target.value) || 1))}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-slate-400">Price paid</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="600.00"
                className={inputClass}
              />
            </div>
          </div>
        )}

        {/* The sale is the revenue event, so it has to be recorded here —
            the visits this package covers are $0 later on. */}
        <p className="mt-2 text-[11px] text-slate-400">
          The price counts as revenue on the day the package is sold. Visits it covers are then $0,
          since the money was already taken here.
          {days > 0 && price.trim() !== "" && !Number.isNaN(parseFloat(price)) && (
            <>
              {" "}
              <span className="font-medium text-slate-500">
                ${(parseFloat(price) / days).toFixed(2)} per day
              </span>{" "}
              vs ${PRICING.daycareFullDay.toFixed(2)} walk-in.
            </>
          )}
        </p>

        {clientLoading && <p className="mt-2 text-xs text-slate-400">Looking up…</p>}

        {!clientLoading && clientChecked && clientMatches.length === 0 && (
          <p className="mt-2 text-xs text-amber-700">
            No dog on file for that number — the client needs to complete the one-time signup first.
          </p>
        )}

        {clientMatches.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-[11px] text-slate-400">
              {shared
                ? "Shared package — covers every dog on this number"
                : "Who is this package for? Tap all that apply."}
            </p>
            <div className="flex flex-wrap gap-2">
              {clientMatches.map((c) => {
                const isSelected = !!c.id && selectedIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={shared}
                    onClick={() => toggleDog(c.id)}
                    className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
                      isSelected && !shared
                        ? "border-accent-500 bg-accent-500 text-white"
                        : "border-accent-200 bg-white text-accent-700 hover:border-accent-400"
                    }`}
                  >
                    {isSelected && !shared ? "✓ " : "🐕 "}
                    {c.dog_name} · {c.last_name}
                  </button>
                );
              })}
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={shared}
                onChange={(e) => setShared(e.target.checked)}
                className="rounded border-slate-300"
              />
              One shared package across every dog on this number
            </label>
          </div>
        )}

        <button
          onClick={addPackages}
          disabled={saving}
          className="mt-4 rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-medium text-white shadow-card hover:bg-accent-600 disabled:opacity-60"
        >
          {saving
            ? "Saving…"
            : shared
              ? "Add shared package"
              : selectedDogs.length > 1
                ? `Add ${selectedDogs.length} packages`
                : "Add package"}
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

          <p className="mb-2 text-sm font-medium text-slate-700">Active packages</p>
          <div className="mb-8 space-y-2">
            {active.map((p) => (
              <PackageRow key={p.id} pkg={p} {...rowProps} />
            ))}
            {active.length === 0 && <p className="text-sm text-slate-400">No active packages.</p>}
          </div>

          {usedUp.length > 0 && (
            <details>
              <summary className="mb-3 cursor-pointer text-sm font-medium text-slate-500">
                Used-up packages ({usedUp.length})
              </summary>
              <div className="space-y-2">
                {usedUp.map((p) => (
                  <PackageRow key={p.id} pkg={p} {...rowProps} />
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100";

function PackageRow({
  pkg,
  allClients,
  usesByPackage,
  historyOpenId,
  setHistoryOpenId,
  editingId,
  setEditingId,
  editTotal,
  setEditTotal,
  saveEditTotal,
  adjustUsed,
  deletePackage,
  deletingId,
}: {
  pkg: Package;
  allClients: Client[];
  usesByPackage: Map<string, PackageUse[]>;
  historyOpenId: string | null;
  setHistoryOpenId: (id: string | null) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  editTotal: number;
  setEditTotal: (n: number) => void;
  saveEditTotal: (pkg: Package) => void;
  adjustUsed: (pkg: Package, delta: number) => void;
  deletePackage: (pkg: Package) => void;
  deletingId: string | null;
}) {
  const left = daysLeft(pkg);
  const history = pkg.id ? (usesByPackage.get(pkg.id) ?? []) : [];
  const isEditing = editingId === pkg.id;
  const showHistory = historyOpenId === pkg.id;
  const client = pkg.dog_name
    ? findClient(allClients, { dogName: pkg.dog_name, phone: pkg.phone })
    : null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-5 py-3.5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800">
            {pkg.dog_name ? (
              <DogLink
                client={client}
                name={pkg.dog_name}
                badges={{ packageDaysLeft: left }}
                className="font-medium text-slate-800"
              />
            ) : (
              <span className="text-slate-500">Shared across all dogs</span>
            )}
            <span className="ml-1.5 font-normal text-slate-400">· {pkg.client_name}</span>
          </p>
          <p className="text-xs text-slate-500">
            {pkg.phone}
            {pkg.created_at && ` · bought ${pkg.created_at.slice(0, 10)}`}
            {pkg.price != null ? (
              <span className="font-medium text-emerald-700"> · ${pkg.price.toFixed(2)}</span>
            ) : (
              // Packages sold before prices were recorded contribute nothing
              // to revenue, which is worth saying rather than showing $0.
              <span className="text-amber-700"> · no price recorded</span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isEditing ? (
            <>
              <input
                type="number"
                min={1}
                value={editTotal}
                onChange={(e) => setEditTotal(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-accent-500"
              />
              <button
                onClick={() => saveEditTotal(pkg)}
                className="rounded-lg bg-accent-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-600"
              >
                Save
              </button>
              <button
                onClick={() => setEditingId(null)}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:border-slate-300"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  left <= 0 ? "bg-rose-50 text-rose-600" : "bg-accent-50 text-accent-700"
                }`}
              >
                {left} of {pkg.total_days} left
              </span>
              <button
                onClick={() => adjustUsed(pkg, 1)}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-slate-300"
                title="Consume one day"
              >
                Use a day
              </button>
              <button
                onClick={() => adjustUsed(pkg, -1)}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-slate-300"
                title="Give a day back"
              >
                Undo
              </button>
              <button
                onClick={() => {
                  setEditingId(pkg.id ?? null);
                  setEditTotal(pkg.total_days);
                }}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-slate-300"
              >
                Edit total
              </button>
              <button
                onClick={() => setHistoryOpenId(showHistory ? null : (pkg.id ?? null))}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-slate-300"
              >
                🗓️ {history.length} used
              </button>
              <button
                onClick={() => deletePackage(pkg)}
                disabled={deletingId === pkg.id}
                className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs text-rose-500 hover:border-rose-300 disabled:opacity-60"
              >
                {deletingId === pkg.id ? "Deleting…" : "Delete"}
              </button>
            </>
          )}
        </div>
      </div>

      {showHistory && (
        <div className="mt-3 rounded-xl bg-slate-50 px-3.5 py-2.5">
          {history.length === 0 ? (
            <p className="text-xs text-slate-400">
              No days recorded yet. Days consumed before this history existed aren&apos;t listed —
              the count above is still correct.
            </p>
          ) : (
            <ul className="space-y-1 text-xs text-slate-600">
              {history.map((u) => (
                <li key={u.id ?? `${u.package_id}-${u.used_on}`} className="flex justify-between gap-3">
                  <span>{prettyDateKey(u.used_on)}</span>
                  <span className="text-slate-400">{u.dog_name ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
