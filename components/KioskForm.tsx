"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { formatPhoneInput } from "@/lib/phone";
import { ADDONS, AddonKey, Client, Package, SERVICE_TYPES, ServiceType, SignAction } from "@/types";

export default function KioskForm() {
  const [action, setAction] = useState<SignAction>("drop_off");
  const [phone, setPhone] = useState("");
  const [dropOffBy, setDropOffBy] = useState("");
  const [service, setService] = useState<ServiceType>("daycare");
  const [addons, setAddons] = useState<AddonKey[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmDaysLeft, setConfirmDaysLeft] = useState<number | null>(null);
  const [error, setError] = useState("");

  const [pkg, setPkg] = useState<Package | null>(null);
  const [pkgLoading, setPkgLoading] = useState(false);

  const [client, setClient] = useState<Client | null>(null);
  const [clientLoading, setClientLoading] = useState(false);
  const [clientChecked, setClientChecked] = useState(false);

  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7) {
      setPkg(null);
      setClient(null);
      setClientChecked(false);
      return;
    }
    lookupTimer.current = setTimeout(async () => {
      setPkgLoading(true);
      setClientLoading(true);
      setClientChecked(false);
      try {
        const supabase = getSupabase();
        const [pkgRes, clientRes] = await Promise.all([
          supabase
            .from("packages")
            .select("*")
            .eq("phone", phone.trim())
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("clients")
            .select("*")
            .eq("phone", phone.trim())
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        if (pkgRes.error) throw pkgRes.error;
        if (clientRes.error) throw clientRes.error;
        setPkg((pkgRes.data as Package) ?? null);
        const foundClient = (clientRes.data as Client) ?? null;
        setClient(foundClient);
        setDropOffBy(foundClient?.drop_off_by ?? "");
      } catch (e) {
        console.error("Lookup failed:", e);
      } finally {
        setPkgLoading(false);
        setClientLoading(false);
        setClientChecked(true);
      }
    }, 500);
  }, [phone]);

  function selectAction(next: SignAction) {
    setAction(next);
    if (next === "pick_up") setAddons([]);
  }

  function toggleAddon(key: AddonKey) {
    setAddons((prev) => (prev.includes(key) ? prev.filter((a) => a !== key) : [...prev, key]));
  }

  function resetForm() {
    setPhone("");
    setDropOffBy("");
    setService("daycare");
    setAddons([]);
    setAction("drop_off");
    setPkg(null);
    setClient(null);
    setClientChecked(false);
  }

  async function handleSubmit() {
    setError("");
    if (!client?.id) {
      setError("Look up a phone number with a completed signup before signing in.");
      return;
    }
    setSubmitting(true);

    const usingPackage = !!pkg && service === "daycare";
    let daysLeftForConfirm: number | null = null;

    try {
      const supabase = getSupabase();

      if (usingPackage && pkg?.id) {
        if (action === "drop_off") {
          const newUsed = Math.min(pkg.total_days, pkg.days_used + 1);
          const { error: pkgErr } = await supabase
            .from("packages")
            .update({ days_used: newUsed })
            .eq("id", pkg.id);
          if (pkgErr) throw pkgErr;
          daysLeftForConfirm = pkg.total_days - newUsed;
        } else {
          daysLeftForConfirm = pkg.total_days - pkg.days_used;
        }
      }

      const { error: err } = await supabase.from("signins").insert({
        dog_name: client.dog_name,
        phone: phone.trim(),
        drop_off_by: dropOffBy.trim(),
        last_name: client.last_name,
        action,
        service_type: service,
        addons,
        package_id: usingPackage ? pkg?.id : null,
        client_id: client.id,
        signature_data: "", // waiver already on file from signup
      });
      if (err) throw err;

      // Fire-and-forget: push this sign-in to PetExec too. Not awaited and
      // errors are only logged, so PetExec being unconfigured, slow, or
      // down never blocks or breaks the kiosk's own sign-in flow.
      fetch("/api/petexec-checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dogName: client.dog_name,
          lastName: client.last_name,
          phone: phone.trim(),
          action,
          serviceType: service,
        }),
      }).catch((e) => console.error("PetExec sync failed:", e));

      setConfirmDaysLeft(daysLeftForConfirm);
      setConfirmed(true);
      setTimeout(() => {
        setConfirmed(false);
        setConfirmDaysLeft(null);
        resetForm();
      }, 2200);
    } catch (e) {
      console.error("Sign-in save failed:", e);
      setError("Couldn't save — check the connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmed) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-accent-500 text-3xl text-white shadow-card">
          ✓
        </div>
        <p className="text-lg font-medium text-slate-800">
          {client?.dog_name || "Dog"} {action === "drop_off" ? "dropped off" : "picked up"}
        </p>
        {confirmDaysLeft !== null && (
          <p className="text-sm font-medium text-accent-600">
            {confirmDaysLeft > 0
              ? `${confirmDaysLeft} day${confirmDaysLeft === 1 ? "" : "s"} left on their package`
              : "That was the last day on their package"}
          </p>
        )}
      </div>
    );
  }

  const digits = phone.replace(/\D/g, "");
  const phoneEntered = digits.length >= 7;
  const showNoProfile = phoneEntered && clientChecked && !clientLoading && !client;

  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-500 text-3xl text-white shadow-card">
          🐾
        </div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">
          Lombard Doggy Daycare
        </h1>
        <p className="mt-1 text-sm text-slate-500">Sign your pup in or out</p>
      </div>

      <div className="rounded-3xl bg-white p-6 shadow-card sm:p-8">
        <div className="mb-6 grid grid-cols-2 gap-3">
          <button
            onClick={() => selectAction("drop_off")}
            className={`rounded-2xl border px-4 py-3 text-sm font-medium transition ${
              action === "drop_off"
                ? "border-accent-500 bg-accent-500 text-white shadow-card"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            }`}
          >
            🚗 Drop off
          </button>
          <button
            onClick={() => selectAction("pick_up")}
            className={`rounded-2xl border px-4 py-3 text-sm font-medium transition ${
              action === "pick_up"
                ? "border-accent-500 bg-accent-500 text-white shadow-card"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            }`}
          >
            🏠 Pick up
          </button>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">Phone number</label>
          <input
            value={phone}
            onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
            placeholder="(123) 456-7890"
            inputMode="numeric"
            autoFocus
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-accent-500 focus:bg-white focus:ring-2 focus:ring-accent-100"
          />

          {phoneEntered && clientLoading && <p className="mt-2 text-xs text-slate-400">Looking you up…</p>}

          {showNoProfile && (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <p className="font-medium">No profile found for this number.</p>
              <p className="mt-1 text-xs text-amber-700">
                First time here? Complete the one-time signup and waiver, then come back and enter your phone number
                to check in.
              </p>
              <Link
                href="/signup"
                className="mt-2 inline-block rounded-xl bg-amber-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-amber-700"
              >
                New client signup
              </Link>
            </div>
          )}

          {client && (
            <div className="mt-3 rounded-2xl border border-accent-100 bg-accent-50 px-4 py-3 text-sm text-accent-800">
              <p className="font-medium">
                🐕 {client.dog_name} · {client.last_name}
              </p>
              {pkgLoading ? (
                <p className="mt-1 text-xs text-accent-600">Checking for a package…</p>
              ) : pkg ? (
                <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium text-accent-700">
                  📦 {Math.max(0, pkg.total_days - pkg.days_used)} of {pkg.total_days} days left
                </span>
              ) : (
                <p className="mt-1 text-xs text-accent-600">No package on file for this number</p>
              )}
            </div>
          )}
        </div>

        {client && (
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">Drop off by</label>
              <input
                value={dropOffBy}
                onChange={(e) => setDropOffBy(e.target.value)}
                placeholder="Parent/guardian"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-accent-500 focus:bg-white focus:ring-2 focus:ring-accent-100"
              />
            </div>

            <div className="flex flex-col">
              <label className="mb-1.5 block text-xs font-medium text-slate-500">Service</label>
              <div className="mb-4 flex flex-wrap gap-2">
                {SERVICE_TYPES.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setService(s.key)}
                    className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                      service === s.key
                        ? "border-accent-500 bg-accent-50 text-accent-700"
                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    {s.icon} {s.label}
                  </button>
                ))}
              </div>

              {action === "drop_off" && (
                <>
                  <label className="mb-1.5 block text-xs font-medium text-slate-500">Add-ons (optional)</label>
                  <div className="flex flex-wrap gap-2">
                    {ADDONS.map((a) => (
                      <button
                        key={a.key}
                        onClick={() => toggleAddon(a.key)}
                        className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                          addons.includes(a.key)
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                        }`}
                      >
                        {a.icon} {a.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {error && <p className="mt-5 text-xs font-medium text-rose-500">{error}</p>}

        <div className="mt-8 flex items-center gap-3">
          <button
            onClick={handleSubmit}
            disabled={submitting || !client}
            className="rounded-xl bg-accent-500 px-6 py-2.5 text-sm font-medium text-white shadow-card transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting
              ? action === "drop_off"
                ? "Signing in…"
                : "Signing out…"
              : action === "drop_off"
              ? "Sign in"
              : "Sign out"}
          </button>
          <Link href="/signup" className="ml-auto text-xs font-medium text-slate-400 hover:text-slate-600">
            New client signup
          </Link>
        </div>
      </div>
    </div>
  );
}
