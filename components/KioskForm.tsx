"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { formatPhoneInput } from "@/lib/phone";
import { estimatePrice, isFullDayVisit } from "@/lib/pricing";
import { prettyDateKey, todayKey } from "@/lib/dates";
import {
  ADDONS,
  AddonKey,
  BathSize,
  Boarding,
  BOARDING_ADDONS,
  Client,
  Package,
  SERVICE_TYPES,
  ServiceType,
  SignAction,
} from "@/types";
import lombardlogo from "@/public/lombardlogo.avif";
import Image from "next/image";

interface ConfirmedDog {
  dogName: string;
  daysLeft: number | null;
  priceDue: number | null;
}

interface OpenVisit {
  serviceType: ServiceType;
  dropOffTime: Date;
  addons: string[];
  bathSize: BathSize | null;
}

export default function KioskForm() {
  const [action, setAction] = useState<SignAction>("drop_off");
  const [phone, setPhone] = useState("");
  const [dropOffBy, setDropOffBy] = useState("");
  const [service, setService] = useState<ServiceType>("daycare");
  // Add-ons are picked per dog, not shared across the whole sign-in — a
  // family dropping off two dogs together might only want a walk for one
  // of them. Keyed by client id.
  const [addonsByDog, setAddonsByDog] = useState<Record<string, AddonKey[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<ConfirmedDog[] | null>(null);
  const [error, setError] = useState("");

  // All packages on file for the entered phone number — a dog-specific
  // package (dog_name set) takes priority; a package with no dog_name is
  // treated as shared across every dog on that number.
  const [packages, setPackages] = useState<Package[]>([]);
  const [pkgLoading, setPkgLoading] = useState(false);

  // Advance boarding reservations on file for the entered phone number —
  // a boarding drop-off is only allowed for a dog with a reservation
  // covering today (see activeBoardingFor below).
  const [boardings, setBoardings] = useState<Boarding[]>([]);

  // All dogs (clients) on file for the entered phone number.
  const [matches, setMatches] = useState<Client[]>([]);
  // Which of those dogs are checking in for this visit — supports more
  // than one at once (e.g. two dogs from the same family together).
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [clientLoading, setClientLoading] = useState(false);
  const [clientChecked, setClientChecked] = useState(false);

  // client_id -> their currently-open visit (a drop-off with no pick-up
  // after it yet), whenever it started — not limited to today, since a
  // boarding stay can span several days. Drives the "signed in" badge,
  // locks pick-up to the same service the dog was dropped off under, and
  // supplies the drop-off time + add-ons + bath size for pricing.
  const [openVisits, setOpenVisits] = useState<Map<string, OpenVisit>>(new Map());

  // Which selected dog's price breakdown is expanded, if any.
  const [breakdownOpenFor, setBreakdownOpenFor] = useState<string | null>(null);

  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dogs whose add-ons have already been pre-filled from their boarding
  // reservation. Tracked so the prefill happens once per selection and
  // never overwrites a change the parent made afterwards.
  const seededFromBoarding = useRef<Set<string>>(new Set());

  const selectedDogs: Client[] = matches.filter((m) => m.id && selectedIds.includes(m.id));

  function packageFor(dogName: string): Package | null {
    const byDog = packages
      .filter((p) => p.dog_name && p.dog_name.trim().toLowerCase() === dogName.trim().toLowerCase())
      .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
    if (byDog.length) return byDog[0];
    const shared = packages
      .filter((p) => !p.dog_name)
      .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
    return shared[0] ?? null;
  }

  // A boarding reservation for this dog that covers today — staff add
  // these in advance on /boardings. A boarding drop-off with no such
  // reservation is blocked (see handleSubmit) rather than silently
  // creating an unplanned stay.
  function activeBoardingFor(dog: Client): Boarding | null {
    const today = todayKey();
    const forDog = boardings.filter(
      (b) => b.dog_name.trim().toLowerCase() === dog.dog_name.trim().toLowerCase()
    );
    return forDog.find((b) => b.start_date <= today && b.end_date >= today) ?? null;
  }

  // The soonest reservation still ahead of this dog — shown for
  // information only when there's no stay running today, so a parent
  // checking in for daycare still sees their upcoming boarding dates.
  function upcomingBoardingFor(dog: Client): Boarding | null {
    const today = todayKey();
    return (
      boardings
        .filter(
          (b) =>
            b.dog_name.trim().toLowerCase() === dog.dog_name.trim().toLowerCase() &&
            b.start_date > today
        )
        .sort((a, b) => a.start_date.localeCompare(b.start_date))[0] ?? null
    );
  }

  // The reservation's add-ons, narrowed to the ones the kiosk actually
  // offers — a boarding reservation can also carry "medication", which
  // isn't a kiosk add-on and is handled by staff, not chosen at the door.
  function kioskAddonsFromBoarding(b: Boarding): AddonKey[] {
    const offered = ADDONS.map((a) => a.key);
    return ((b.addons ?? []) as string[]).filter((a): a is AddonKey =>
      offered.includes(a as AddonKey)
    );
  }

  // The service type that actually applies for this dog's current
  // action. At pick-up it's locked to whatever they were dropped off
  // under. At drop-off, a dog whose reservation covers today is always
  // boarding — the stay is already booked, so it can't be signed in as a
  // daycare visit — otherwise it's whatever the selector says. Decided
  // per dog, so one dog boarding doesn't force its housemate to.
  function effectiveService(dog: Client): ServiceType {
    if (action === "pick_up" && dog.id) {
      const open = openVisits.get(dog.id);
      if (open) return open.serviceType;
    }
    if (action === "drop_off" && activeBoardingFor(dog)) return "boarding";
    return service;
  }

  // A package only ever covers a FULL daycare day. Whether it applies
  // depends on how long the visit actually is, so this is evaluated
  // against a given "now" (live for the preview, submit-time for real).
  function packageAppliesNow(dog: Client, open: OpenVisit | undefined, pkg: Package | null, now: Date): boolean {
    if (!pkg || !open) return false;
    if (effectiveService(dog) !== "daycare") return false;
    return isFullDayVisit(open.dropOffTime, now);
  }

  useEffect(() => {
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7) {
      setPackages([]);
      setMatches([]);
      setSelectedIds([]);
      setOpenVisits(new Map());
      setBoardings([]);
      setClientChecked(false);
      return;
    }
    lookupTimer.current = setTimeout(async () => {
      setPkgLoading(true);
      setClientLoading(true);
      setClientChecked(false);
      try {
        const supabase = getSupabase();
        const [pkgRes, clientRes, historyRes, boardingRes] = await Promise.all([
          supabase.from("packages").select("*").eq("phone", phone.trim()),
          supabase.from("clients").select("*").eq("phone", phone.trim()).order("created_at", { ascending: true }),
          // Not date-limited: a boarding stay's drop-off can be several
          // days before its pick-up, so "today only" would miss it.
          supabase
            .from("signins")
            .select("client_id, action, service_type, addons, bath_size, created_at")
            .eq("phone", phone.trim())
            .order("created_at", { ascending: true })
            .limit(300),
          supabase.from("boardings").select("*").eq("phone", phone.trim()),
        ]);
        if (pkgRes.error) throw pkgRes.error;
        if (clientRes.error) throw clientRes.error;
        if (historyRes.error) throw historyRes.error;
        if (boardingRes.error) throw boardingRes.error;

        setPackages((pkgRes.data as Package[]) ?? []);
        setBoardings((boardingRes.data as Boarding[]) ?? []);
        const found = (clientRes.data as Client[]) ?? [];
        setMatches(found);

        // Walk history in order — the last drop-off and last pick-up per
        // dog decide whether they're currently checked in, and under
        // which service. bath_size can be set on the drop-off row at any
        // time via /records (even mid-visit), so it's picked up here too.
        type HistoryRow = {
          client_id: string | null;
          action: SignAction;
          service_type: ServiceType;
          addons: string[] | null;
          bath_size: BathSize | null;
          created_at: string;
        };
        const lastDropOff = new Map<
          string,
          { serviceType: ServiceType; time: Date; addons: string[]; bathSize: BathSize | null }
        >();
        const lastPickUp = new Map<string, Date>();
        for (const r of (historyRes.data as HistoryRow[]) ?? []) {
          if (!r.client_id) continue;
          if (r.action === "drop_off") {
            lastDropOff.set(r.client_id, {
              serviceType: r.service_type,
              time: new Date(r.created_at),
              addons: r.addons ?? [],
              bathSize: r.bath_size ?? null,
            });
          } else {
            lastPickUp.set(r.client_id, new Date(r.created_at));
          }
        }
        const open = new Map<string, OpenVisit>();
        lastDropOff.forEach((drop, clientId) => {
          const pickUp = lastPickUp.get(clientId);
          if (!pickUp || drop.time > pickUp) {
            open.set(clientId, {
              serviceType: drop.serviceType,
              dropOffTime: drop.time,
              addons: drop.addons,
              bathSize: drop.bathSize,
            });
          }
        });
        setOpenVisits(open);

        // A single dog on file auto-selects itself; with more than one,
        // nothing is pre-selected — the person picks who's checking in.
        if (found.length === 1) {
          setSelectedIds(found[0].id ? [found[0].id] : []);
          setDropOffBy(found[0].drop_off_by ?? "");
        } else {
          setSelectedIds([]);
          setDropOffBy("");
        }
      } catch (e) {
        console.error("Lookup failed:", e);
      } finally {
        setPkgLoading(false);
        setClientLoading(false);
        setClientChecked(true);
      }
    }, 500);
  }, [phone]);

  // Pre-fill each selected dog's add-ons from its boarding reservation —
  // staff already agreed these with the client when the stay was booked,
  // so the parent shouldn't have to re-pick them at the door. Runs once
  // per dog per selection; toggling any chip afterwards sticks, and
  // deselecting the dog lets it seed fresh next time.
  useEffect(() => {
    if (action !== "drop_off") return;
    for (const dog of selectedDogs) {
      if (!dog.id || seededFromBoarding.current.has(dog.id)) continue;
      const reservation = activeBoardingFor(dog);
      if (!reservation) continue;
      seededFromBoarding.current.add(dog.id);
      const preset = kioskAddonsFromBoarding(reservation);
      if (preset.length) {
        setAddonsByDog((prev) => ({ ...prev, [dog.id as string]: preset }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, boardings, action]);

  // A dog that's been deselected should seed again if it's picked back up.
  useEffect(() => {
    for (const id of Array.from(seededFromBoarding.current)) {
      if (!selectedIds.includes(id)) seededFromBoarding.current.delete(id);
    }
  }, [selectedIds]);

  function selectAction(next: SignAction) {
    setAction(next);
    if (next === "pick_up") {
      setAddonsByDog({});
      seededFromBoarding.current.clear();
    }
  }

  function toggleAddon(dogId: string, key: AddonKey) {
    setAddonsByDog((prev) => {
      const current = prev[dogId] ?? [];
      return {
        ...prev,
        [dogId]: current.includes(key) ? current.filter((a) => a !== key) : [...current, key],
      };
    });
  }

  function toggleDog(id: string | undefined) {
    if (!id) return;
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function resetForm() {
    setPhone("");
    setDropOffBy("");
    setService("daycare");
    setAddonsByDog({});
    seededFromBoarding.current.clear();
    setAction("drop_off");
    setPackages([]);
    setMatches([]);
    setSelectedIds([]);
    setOpenVisits(new Map());
    setBoardings([]);
    setClientChecked(false);
    setBreakdownOpenFor(null);
  }

  async function handleSubmit() {
    setError("");
    if (selectedDogs.length === 0) {
      setError(
        matches.length > 1
          ? "Select which dog (or dogs) are checking in."
          : "Look up a phone number with a completed signup before signing in."
      );
      return;
    }
    if (action === "drop_off") {
      const alreadyIn = selectedDogs.filter((d) => d.id && openVisits.has(d.id));
      if (alreadyIn.length) {
        setError(
          `${alreadyIn.map((d) => d.dog_name).join(", ")} ${
            alreadyIn.length > 1 ? "are" : "is"
          } already signed in — pick them up before dropping off again.`
        );
        return;
      }
      // Dogs with a reservation are boarding regardless of the selector,
      // so only the others can trip this — picking Boarding for a dog
      // with nothing booked is the case being blocked.
      if (service === "boarding") {
        const noReservation = selectedDogs.filter((d) => !activeBoardingFor(d));
        if (noReservation.length) {
          setError(
            `No reservation found for ${noReservation
              .map((d) => d.dog_name)
              .join(", ")}. Pick a different service, or ask staff to add a boarding reservation first.`
          );
          return;
        }
      }
    }
    setSubmitting(true);

    try {
      const supabase = getSupabase();
      const results: ConfirmedDog[] = [];
      const now = new Date();

      // One dog at a time so a package-day deduction failure for one dog
      // doesn't affect the others' rows.
      for (const dog of selectedDogs) {
        const effService = effectiveService(dog);
        const pkg = packageFor(dog.dog_name);
        const open = dog.id ? openVisits.get(dog.id) : undefined;
        let usingPackage = false;
        let daysLeftForConfirm: number | null = null;
        let priceDue: number | null = null;

        // Package days are only ever consumed at pick-up, once the actual
        // visit length is known — a package covers a FULL daycare day
        // only, never a half day, so this can't be decided at drop-off.
        if (action === "pick_up" && pkg?.id && packageAppliesNow(dog, open, pkg, now)) {
          usingPackage = true;
          const newUsed = Math.min(pkg.total_days, pkg.days_used + 1);
          const { error: pkgErr } = await supabase.from("packages").update({ days_used: newUsed }).eq("id", pkg.id);
          if (pkgErr) throw pkgErr;
          daysLeftForConfirm = pkg.total_days - newUsed;
        }

        // Work out what's owed at pick-up — a package only ever covers
        // the full-day rate itself, so walk/nail-trim/bath still apply on
        // top even when a package is in use. Boarding never uses
        // packages, so it always gets its full nightly + late-fee math.
        if (action === "pick_up" && open) {
          const estimate = estimatePrice(effService, open.dropOffTime, now, open.addons, usingPackage, open.bathSize);
          priceDue = estimate?.amount ?? null;
        }

        const dogAddons = dog.id ? (addonsByDog[dog.id] ?? []) : [];
        const { error: err } = await supabase.from("signins").insert({
          dog_name: dog.dog_name,
          phone: phone.trim(),
          drop_off_by: action === "drop_off" ? dropOffBy.trim() : "",
          pick_up_by: action === "pick_up" ? dropOffBy.trim() : "",
          last_name: dog.last_name,
          action,
          service_type: effService,
          addons: dogAddons,
          package_id: pkg?.id ?? null,
          client_id: dog.id,
          price: priceDue,
          signature_data: "", // waiver already on file from signup
        });
        if (err) throw err;

        // Fire-and-forget: push this sign-in to PetExec too, per dog. Not
        // awaited and errors are only logged, so PetExec being
        // unconfigured, slow, or down never blocks the kiosk.
        fetch("/api/petexec-checkin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dogName: dog.dog_name,
            lastName: dog.last_name,
            phone: phone.trim(),
            action,
            serviceType: effService,
          }),
        }).catch((e) => console.error("PetExec sync failed:", e));

        results.push({ dogName: dog.dog_name, daysLeft: daysLeftForConfirm, priceDue });
      }

      setConfirmed(results);
      setTimeout(() => {
        setConfirmed(null);
        resetForm();
      }, 2600);
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
        <div className="space-y-1.5">
          {confirmed.map((c) => (
            <p key={c.dogName} className="text-lg font-medium text-slate-800">
              {c.dogName} {action === "drop_off" ? "dropped off" : "picked up"}
              {c.daysLeft !== null && (
                <span className="ml-2 text-sm font-medium text-accent-600">
                  {c.daysLeft > 0 ? `· ${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"} left` : "· last day on package"}
                </span>
              )}
              {c.priceDue !== null && (
                <span className="ml-2 text-sm font-medium text-emerald-600">· ${c.priceDue.toFixed(2)} due</span>
              )}
            </p>
          ))}
        </div>
      </div>
    );
  }

  const digits = phone.replace(/\D/g, "");
  const phoneEntered = digits.length >= 7;
  const showNoProfile = phoneEntered && clientChecked && !clientLoading && matches.length === 0;
  const showDogPicker = matches.length > 1;
  const now = new Date();
  const hasDuplicateDropOff =
    action === "drop_off" && selectedDogs.some((d) => d.id && openVisits.has(d.id));
  // Dogs whose stay covers today — they sign in as boarding no matter
  // what the service selector says (see effectiveService). The rest fall
  // to the selector, so a reserved dog and a daycare dog can check in
  // together on one sign-in.
  const reservedDogs =
    action === "drop_off" ? selectedDogs.filter((d) => !!activeBoardingFor(d)) : [];
  const unreservedDogs =
    action === "drop_off" ? selectedDogs.filter((d) => !activeBoardingFor(d)) : [];
  // Only a dog with no reservation can be missing one — asking to board
  // it explicitly via the selector is what's blocked here.
  const hasMissingBoardingReservation =
    action === "drop_off" &&
    service === "boarding" &&
    unreservedDogs.some((d) => !d.id || !openVisits.has(d.id));

  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="mb-3 flex items-center gap-2.5">
          <span className="flex  items-center justify-center rounded-2xl  text-xl text-white shadow-card">
            <Image
              src={lombardlogo}
              alt={"Logo"}
              width={100}
              height={100}
              objectFit=""
              className="object-cover"
            />
          </span>
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
            }`}>
            🚗 Drop off
          </button>
          <button
            onClick={() => selectAction("pick_up")}
            className={`rounded-2xl border px-4 py-3 text-sm font-medium transition ${
              action === "pick_up"
                ? "border-accent-500 bg-accent-500 text-white shadow-card"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            }`}>
            🏠 Pick up
          </button>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">
            Phone number
          </label>
          <input
            value={phone}
            onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
            placeholder="(123) 456-7890"
            inputMode="numeric"
            autoFocus
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-accent-500 focus:bg-white focus:ring-2 focus:ring-accent-100"
          />

          {phoneEntered && clientLoading && (
            <p className="mt-2 text-xs text-slate-400">Looking you up…</p>
          )}

          {showNoProfile && (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <p className="font-medium">No profile found for this number.</p>
              <p className="mt-1 text-xs text-amber-700">
                First time here? Complete the one-time signup and waiver, then
                come back and enter your phone number to check in.
              </p>
              <Link
                href="/signup"
                className="mt-2 inline-block rounded-xl bg-amber-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-amber-700">
                New client signup
              </Link>
            </div>
          )}

          {showDogPicker && (
            <div className="mt-3 rounded-2xl border border-accent-100 bg-accent-50 px-4 py-3">
              <p className="text-sm font-medium text-accent-800">
                Which dog (or dogs)?
              </p>
              <p className="mt-0.5 text-xs text-accent-600">
                This number has {matches.length} dogs on file — tap all that are
                checking in together.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {matches.map((m) => {
                  const selected = !!m.id && selectedIds.includes(m.id);
                  const isIn = !!m.id && openVisits.has(m.id);
                  const pkg = packageFor(m.dog_name);
                  return (
                    <button
                      key={m.id}
                      onClick={() => toggleDog(m.id)}
                      className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                        selected
                          ? "border-accent-500 bg-accent-500 text-white"
                          : "border-accent-200 bg-white text-accent-700 hover:border-accent-400"
                      }`}>
                      {selected ? "✓ " : "🐕 "}
                      {m.dog_name}
                      {isIn && !selected ? " · 🟢 signed in" : ""}
                      {pkg && !selected ? " 📦" : ""}
                    </button>
                  );
                })}
              </div>
              <Link
                href="/signup"
                className="mt-2 inline-block text-xs font-medium text-accent-600 hover:text-accent-800">
                Add another dog to this number
              </Link>
            </div>
          )}

          {selectedDogs.length > 0 && (
            <div className="mt-3 space-y-2">
              {selectedDogs.map((dog) => {
                const pkg = packageFor(dog.dog_name);
                const open = dog.id ? openVisits.get(dog.id) : undefined;
                const isIn = !!open;
                const effService = effectiveService(dog);
                const serviceLabel = SERVICE_TYPES.find(
                  (s) => s.key === effService,
                );
                const usingPackage =
                  action === "pick_up"
                    ? packageAppliesNow(dog, open, pkg, now)
                    : false;
                const priceEstimate =
                  action === "pick_up" && open
                    ? estimatePrice(
                        effService,
                        open.dropOffTime,
                        now,
                        open.addons,
                        usingPackage,
                        open.bathSize,
                      )
                    : null;
                const showBreakdown = breakdownOpenFor === dog.id;
                const reservation = activeBoardingFor(dog);
                // Only today's stay drives the add-on prefill; an upcoming
                // one is shown purely so the parent can see it's booked.
                const upcoming = reservation ? null : upcomingBoardingFor(dog);
                const shownReservation = reservation ?? upcoming;
                return (
                  <div
                    key={dog.id}
                    className="rounded-2xl border border-accent-100 bg-accent-50 px-4 py-3 text-sm text-accent-800">
                  <div className="flex items-start gap-3">
                    <div className="shrink-0">
                      {dog.photo_data ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={dog.photo_data}
                          alt={`${dog.dog_name}'s photo`}
                          className="h-14 w-14 rounded-full object-cover ring-2 ring-white"
                        />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-xl ring-2 ring-white">
                          🐕
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {dog.dog_name} · {dog.last_name}
                      {isIn && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                          🟢 Signed in
                        </span>
                      )}
                      {action === "pick_up" && open && (
                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-accent-700">
                          {serviceLabel?.icon} {serviceLabel?.label}
                        </span>
                      )}
                      {action === "drop_off" && !isIn && reservation && (
                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-accent-700">
                          🛏️ Boarding · reserved
                        </span>
                      )}
                    </p>
                    {pkgLoading ? (
                      <p className="mt-1 text-xs text-accent-600">
                        Checking for a package…
                      </p>
                    ) : pkg ? (
                      <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium text-accent-700">
                        📦 {Math.max(0, pkg.total_days - pkg.days_used)} of{" "}
                        {pkg.total_days} days left
                        {action === "pick_up" &&
                          open &&
                          !usingPackage &&
                          " — today's visit was 4hrs or less, half day rate applies"}
                      </span>
                    ) : (
                      <p className="mt-1 text-xs text-accent-600">
                        No package on file for {dog.dog_name}
                      </p>
                    )}
                    {shownReservation && (
                      <div className="mt-2 rounded-xl bg-white px-3 py-2 text-xs text-slate-600">
                        <p className="font-medium text-accent-800">
                          🛏️ {upcoming ? "Upcoming boarding reservation" : "Boarding reservation on file"}
                        </p>
                        <p className="mt-0.5">
                          {prettyDateKey(shownReservation.start_date)} →{" "}
                          {prettyDateKey(shownReservation.end_date)}
                          <span className="text-slate-400">
                            {" "}
                            · pick up {prettyDateKey(shownReservation.end_date)}
                          </span>
                        </p>
                        {(shownReservation.addons ?? []).length > 0 && (
                          <p className="mt-0.5">
                            Add-ons booked:{" "}
                            {(shownReservation.addons ?? [])
                              .map((a) => {
                                const label = BOARDING_ADDONS.find((x) => x.key === a)?.label ?? a;
                                if (a === "walk" && shownReservation.walks_per_day) {
                                  return `${label} (${shownReservation.walks_per_day}/day)`;
                                }
                                if (a === "bath" && shownReservation.bath_size) {
                                  return `${label} (${shownReservation.bath_size})`;
                                }
                                return label;
                              })
                              .join(", ")}
                          </p>
                        )}
                        {/* {shownReservation.feeding_instructions && (
                          <p className="mt-0.5 text-slate-500">🍽️ {shownReservation.feeding_instructions}</p>
                        )} */}
                      </div>
                    )}
                    {action === "drop_off" && !isIn && (
                      <div className="mt-2">
                        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-accent-500">
                          Add-ons for {dog.dog_name} (optional)
                          {reservation && (
                            <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">
                              — pre-filled from the reservation, tap to change
                            </span>
                          )}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {ADDONS.map((a) => {
                            const active = !!dog.id && (addonsByDog[dog.id] ?? []).includes(a.key);
                            return (
                              <button
                                key={a.key}
                                onClick={() => dog.id && toggleAddon(dog.id, a.key)}
                                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                                  active
                                    ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                                }`}>
                                {a.icon} {a.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {priceEstimate && (
                      <div className="mt-1.5">
                        <button
                          onClick={() =>
                            setBreakdownOpenFor(
                              showBreakdown ? null : (dog.id ?? null),
                            )
                          }
                          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-200">
                          💵 ${priceEstimate.amount.toFixed(2)} due —{" "}
                          {priceEstimate.label}
                          <span className="text-emerald-500">🧾</span>
                        </button>
                        {showBreakdown && (
                          <ul className="mt-1.5 space-y-0.5 rounded-xl bg-white px-3 py-2 text-xs text-slate-600">
                            {priceEstimate.breakdown.map((item, i) => (
                              <li
                                key={i}
                                className="flex justify-between gap-4">
                                <span>{item.label}</span>
                                <span className="font-medium">
                                  ${item.amount.toFixed(2)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                    {action === "pick_up" &&
                      open?.addons.includes("bath") &&
                      !open.bathSize && (
                        <p className="mt-1.5 text-xs font-medium text-amber-700">
                          🛁 Bath requested — please ask one of the staff for
                          pricing information.
                        </p>
                      )}
                    {action === "pick_up" && !open && (
                      <p className="mt-1.5 text-xs text-accent-600">
                        {dog.dog_name} is not signed in yet — please select drop
                        off.
                      </p>
                    )}
                    {isIn && action === "drop_off" && (
                      <p className="mt-2 rounded-lg bg-amber-100 px-2.5 py-1.5 text-xs font-medium text-amber-800">
                        {dog.dog_name} is already signed in — pick up first
                        before dropping off again.
                      </p>
                    )}
                    {!isIn &&
                      action === "drop_off" &&
                      service === "boarding" &&
                      !activeBoardingFor(dog) && (
                        <p className="mt-2 rounded-lg bg-rose-100 px-2.5 py-1.5 text-xs font-medium text-rose-700">
                          🛏️ No reservation found for {dog.dog_name} — ask
                          staff to add a boarding reservation before drop-off.
                        </p>
                      )}
                    </div>
                  </div>
                  </div>
                );
              })}
            </div>
          )}

          {matches.length === 1 && (
            <Link
              href="/signup"
              className="mt-2 inline-block text-xs font-medium text-slate-400 hover:text-slate-600">
              Add another dog to this number
            </Link>
          )}
        </div>

        {selectedDogs.length > 0 && (
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">
                {action === "drop_off" ? "Drop off by" : "Picked up by"}
              </label>
              <input
                value={dropOffBy}
                onChange={(e) => setDropOffBy(e.target.value)}
                placeholder="Parent/guardian"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-accent-500 focus:bg-white focus:ring-2 focus:ring-accent-100"
              />
            </div>

            <div className="flex flex-col">
              {/* At pick-up, service is locked per-dog from their drop-off
                  (shown as badges above) — a dog signed in as daycare can
                  only be picked up as daycare, same for boarding. The
                  selector below only matters for drop-off, or as a manual
                  fallback for a dog with no open drop-off on file. */}
              {action === "drop_off" ? (
                <>
                  {/* Reserved dogs are already boarding, so this selector
                      only governs the dogs without a reservation — that's
                      what lets one dog board while another does daycare
                      in the same sign-in. */}
                  {reservedDogs.length > 0 && (
                    <p className="mb-2 rounded-lg bg-accent-50 px-2.5 py-1.5 text-xs text-accent-700">
                      🛏️ {reservedDogs.map((d) => d.dog_name).join(", ")}{" "}
                      {reservedDogs.length > 1 ? "are" : "is"} boarding today — set by the reservation.
                    </p>
                  )}
                  {unreservedDogs.length > 0 && (
                    <>
                      <label className="mb-1.5 block text-xs font-medium text-slate-500">
                        Service
                        {reservedDogs.length > 0 && (
                          <span className="ml-1 font-normal text-slate-400">
                            for {unreservedDogs.map((d) => d.dog_name).join(", ")}
                          </span>
                        )}
                      </label>
                      <div className="mb-4 flex flex-wrap gap-2">
                        {SERVICE_TYPES.map((s) => (
                          <button
                            key={s.key}
                            onClick={() => setService(s.key)}
                            className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                              service === s.key
                                ? "border-accent-500 bg-accent-50 text-accent-700"
                                : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                            }`}>
                            {s.icon} {s.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              ) : (
                selectedDogs.some((d) => !d.id || !openVisits.has(d.id)) && (
                  <>
                    <label className="mb-1.5 block text-xs font-medium text-slate-500">
                      Service (fallback for dogs with no open drop-off)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {SERVICE_TYPES.map((s) => (
                        <button
                          key={s.key}
                          onClick={() => setService(s.key)}
                          className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                            service === s.key
                              ? "border-accent-500 bg-accent-50 text-accent-700"
                              : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                          }`}>
                          {s.icon} {s.label}
                        </button>
                      ))}
                    </div>
                  </>
                )
              )}
            </div>
          </div>
        )}

        {error && (
          <p className="mt-5 text-xs font-medium text-rose-500">{error}</p>
        )}

        <div className="mt-8 flex items-center gap-3">
          <button
            onClick={handleSubmit}
            disabled={
              submitting ||
              selectedDogs.length === 0 ||
              hasDuplicateDropOff ||
              hasMissingBoardingReservation
            }
            className="rounded-xl bg-accent-500 px-6 py-2.5 text-sm font-medium text-white shadow-card transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-50">
            {submitting
              ? action === "drop_off"
                ? "Signing in…"
                : "Signing out…"
              : hasDuplicateDropOff
                ? "Already signed in"
                : hasMissingBoardingReservation
                  ? "No reservation found"
                  : action === "drop_off"
                  ? selectedDogs.length > 1
                    ? `Sign in ${selectedDogs.length} dogs`
                    : "Sign in"
                  : selectedDogs.length > 1
                    ? `Sign out ${selectedDogs.length} dogs`
                    : "Sign out"}
          </button>
          <Link
            href="/signup"
            className="ml-auto text-xs font-medium text-slate-400 hover:text-slate-600">
            New client signup
          </Link>
        </div>
      </div>
    </div>
  );
}
