"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { formatPhoneInput } from "@/lib/phone";
import { dateRange, prettyDateKey } from "@/lib/dates";
import { estimateBoardingTotal } from "@/lib/pricing";
import { fileToResizedDataUrl } from "@/lib/image";
import { Boarding, Client, MEAL_TYPES, MealLog, MealType, SignInRecord } from "@/types";
import { isStaffUnlocked, markStaffUnlocked } from "@/lib/staffAuth";
import StaffNav from "@/components/StaffNav";

const PASSCODE = process.env.NEXT_PUBLIC_RECORDS_PASSCODE;

export default function ReportPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [entered, setEntered] = useState("");
  const [error, setError] = useState("");

  const [phone, setPhone] = useState("");
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  const [boardingsForDog, setBoardingsForDog] = useState<Boarding[]>([]);
  const [selectedBoardingId, setSelectedBoardingId] = useState<string | null>(null);
  const [signins, setSignins] = useState<SignInRecord[]>([]);
  const [mealLogs, setMealLogs] = useState<MealLog[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    if (isStaffUnlocked()) setUnlocked(true);
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7) {
      setMatches([]);
      return;
    }
    const timer = setTimeout(searchPhone, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, unlocked]);

  function checkPasscode() {
    if (entered === PASSCODE) {
      markStaffUnlocked();
      setUnlocked(true);
      setError("");
    } else {
      setError("Wrong passcode.");
    }
  }

  async function searchPhone() {
    setSearching(true);
    setError("");
    try {
      const supabase = getSupabase();
      const { data, error: err } = await supabase.from("clients").select("*").eq("phone", phone.trim());
      if (err) throw err;
      setMatches((data as Client[]) ?? []);
    } catch (e) {
      console.error("Client search failed:", e);
      setError("Could not search for that phone number.");
    } finally {
      setSearching(false);
    }
  }

  // Deep-link from the boarding page's Print button (?boardingId=...) —
  // loads that specific reservation directly instead of making staff
  // search by phone again.
  useEffect(() => {
    if (!unlocked) return;
    const params = new URLSearchParams(window.location.search);
    const boardingId = params.get("boardingId");
    if (!boardingId) return;
    (async () => {
      setLoadingDetail(true);
      setError("");
      try {
        const supabase = getSupabase();
        const { data, error: err } = await supabase.from("boardings").select("*").eq("id", boardingId).single();
        if (err) throw err;
        const boarding = data as Boarding;
        const { data: clientMatches } = await supabase
          .from("clients")
          .select("*")
          .eq("phone", boarding.phone)
          .ilike("dog_name", boarding.dog_name);
        const client: Client =
          (clientMatches as Client[] | null)?.[0] ??
          ({
            phone: boarding.phone,
            dog_name: boarding.dog_name,
            last_name: boarding.last_name,
            drop_off_by: "",
            signature_data: "",
          } as Client);
        await selectClient(client);
        setSelectedBoardingId(boarding.id ?? null);
      } catch (e) {
        console.error("Loading boarding for print failed:", e);
        setError("Could not load that reservation.");
      } finally {
        setLoadingDetail(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  async function selectClient(client: Client) {
    setSelectedClient(client);
    setLoadingDetail(true);
    setError("");
    setSelectedBoardingId(null);
    setMealLogs([]);
    try {
      const supabase = getSupabase();
      const [signinsRes, boardingsRes] = await Promise.all([
        supabase
          .from("signins")
          .select("*")
          .eq("client_id", client.id)
          .order("created_at", { ascending: true }),
        supabase
          .from("boardings")
          .select("*")
          .eq("phone", client.phone)
          .ilike("dog_name", client.dog_name)
          .order("start_date", { ascending: false }),
      ]);
      if (signinsRes.error) throw signinsRes.error;
      if (boardingsRes.error) throw boardingsRes.error;
      setSignins((signinsRes.data as SignInRecord[]) ?? []);
      const dogBoardings = (boardingsRes.data as Boarding[]) ?? [];
      setBoardingsForDog(dogBoardings);
      if (dogBoardings.length) setSelectedBoardingId(dogBoardings[0].id ?? null);
    } catch (e) {
      console.error("Loading dog detail failed:", e);
      setError("Could not load this dog's records.");
    } finally {
      setLoadingDetail(false);
    }
  }

  // Staff set this once per dog, after signup — it then shows read-only on
  // the kiosk sign-in/out page for that dog going forward (see
  // components/KioskForm.tsx), so parents recognize their own dog's card
  // but can't change the photo themselves.
  async function handleClientPhotoChange(client: Client, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !client.id) return;
    try {
      const dataUrl = await fileToResizedDataUrl(file);
      const supabase = getSupabase();
      const { error: err } = await supabase.from("clients").update({ photo_data: dataUrl }).eq("id", client.id);
      if (err) throw err;
      setSelectedClient((prev) => (prev && prev.id === client.id ? { ...prev, photo_data: dataUrl } : prev));
    } catch (e) {
      console.error("Saving dog photo failed:", e);
      setError("Could not save that photo — try a different one.");
    }
  }

  const selectedBoarding = useMemo(
    () => boardingsForDog.find((b) => b.id === selectedBoardingId) ?? null,
    [boardingsForDog, selectedBoardingId]
  );

  useEffect(() => {
    if (!selectedBoardingId) {
      setMealLogs([]);
      return;
    }
    (async () => {
      try {
        const supabase = getSupabase();
        const { data, error: err } = await supabase
          .from("meal_logs")
          .select("*")
          .eq("boarding_id", selectedBoardingId);
        if (err) throw err;
        setMealLogs((data as MealLog[]) ?? []);
      } catch (e) {
        console.error("Loading meal logs failed:", e);
      }
    })();
  }, [selectedBoardingId]);

  async function toggleMeal(day: string, mealType: MealType) {
    if (!selectedBoardingId) return;
    const existing = mealLogs.find((m) => m.date === day && m.meal_type === mealType);
    try {
      const supabase = getSupabase();
      if (existing?.id) {
        const nextFed = !existing.fed;
        const { error: err } = await supabase
          .from("meal_logs")
          .update({ fed: nextFed, fed_by: nextFed ? existing.fed_by : null })
          .eq("id", existing.id);
        if (err) throw err;
        setMealLogs((prev) => prev.map((m) => (m.id === existing.id ? { ...m, fed: nextFed } : m)));
      } else {
        const staffName = window.prompt("Your name (for the feeding chart):", "");
        if (staffName === null) return; // cancelled
        const { data, error: err } = await supabase
          .from("meal_logs")
          .insert({ boarding_id: selectedBoardingId, date: day, meal_type: mealType, fed: true, fed_by: staffName.trim() || null })
          .select()
          .single();
        if (err) throw err;
        setMealLogs((prev) => [...prev, data as MealLog]);
      }
    } catch (e) {
      console.error("Updating meal log failed:", e);
      setError("Could not update the meal log.");
    }
  }

  // Sign-ins scoped to the selected boarding's date range, or the full
  // history when no boarding stay is selected (daycare/meet & greet dogs
  // don't have a boarding reservation at all).
  const relevantSignins = useMemo(() => {
    if (!selectedBoarding) return signins;
    const start = selectedBoarding.start_date;
    const end = selectedBoarding.end_date;
    return signins.filter((s) => {
      if (!s.created_at) return false;
      const d = s.created_at.slice(0, 10);
      return d >= start && d <= end;
    });
  }, [signins, selectedBoarding]);

  // Nightly rate + add-ons for the boarding stay, from the reservation
  // itself — this is the source of truth used on /boardings too, so the
  // printed total is correct even mid-stay, before a pick-up price (which
  // is the only thing signins would otherwise carry the nightly rate on)
  // has been recorded.
  const boardingEstimate = useMemo(() => {
    if (!selectedBoarding) return null;
    return estimateBoardingTotal(selectedBoarding.start_date, selectedBoarding.end_date, {
      addons: selectedBoarding.addons ?? [],
      walksPerDay: selectedBoarding.walks_per_day,
      bathSize: selectedBoarding.bath_size ?? null,
    });
  }, [selectedBoarding]);

  const totalForStay = useMemo(() => {
    if (selectedBoarding && boardingEstimate) return boardingEstimate.amount;
    return relevantSignins.reduce((sum, s) => sum + (s.price ?? 0), 0);
  }, [selectedBoarding, boardingEstimate, relevantSignins]);

  const addonsUsed = useMemo(() => {
    const set = new Set<string>();
    relevantSignins.forEach((s) => {
      (s.addons ?? []).forEach((a) => set.add(a === "bath" && s.bath_size ? `Bath (${s.bath_size})` : a));
    });
    return Array.from(set);
  }, [relevantSignins]);

  const chartDays = useMemo(
    () => (selectedBoarding ? dateRange(selectedBoarding.start_date, selectedBoarding.end_date) : []),
    [selectedBoarding]
  );

  if (!unlocked) {
    return (
      <div className="mx-auto mt-28 flex max-w-xs flex-col gap-3 px-5">
        <h1 className="font-display text-xl font-semibold text-slate-900">Staff dog report</h1>
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
    <div className="mx-auto max-w-3xl px-6 py-10 print:px-0 print:py-0">
      <style>{`
        @media print {
          @page { margin: 0.5in; size: portrait; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-header {
            background: linear-gradient(135deg, #f59e0b 0%, #f97316 100%);
            border-radius: 20px;
          }
        }
      `}</style>

      <StaffNav current="/report" />

      <div className="mb-6 flex items-center justify-between print:hidden">
        <h1 className="font-display text-xl font-semibold text-slate-900">
          Dog report
        </h1>
        {selectedClient && (
          <button
            onClick={() => window.print()}
            className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow-card hover:bg-accent-600">
            🖨️ Print / Save as PDF
          </button>
        )}
      </div>

      {!selectedClient && (
        <div className="print:hidden">
          <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
            <label className="mb-1.5 block text-xs font-medium text-slate-500">
              Search by phone number
            </label>
            <input
              value={phone}
              onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
              placeholder="(123) 456-7890"
              inputMode="numeric"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
            />
            {searching && (
              <p className="mt-2 text-xs text-slate-400">Searching…</p>
            )}
            {error && (
              <p className="mt-2 text-xs font-medium text-rose-500">{error}</p>
            )}
          </div>

          {matches.length > 0 && (
            <div className="space-y-2">
              {matches.map((c) => (
                <button
                  key={c.id}
                  onClick={() => selectClient(c)}
                  className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-left shadow-card hover:border-accent-300">
                  <span className="text-sm font-medium text-slate-800">
                    🐕 {c.dog_name}{" "}
                    <span className="font-normal text-slate-500">
                      · {c.last_name}
                    </span>
                  </span>
                  <span className="text-xs text-slate-400">{c.phone}</span>
                </button>
              ))}
            </div>
          )}
          {!searching &&
            phone.replace(/\D/g, "").length >= 7 &&
            matches.length === 0 && (
              <p className="text-sm text-slate-400">
                No dog on file for that number.
              </p>
            )}
        </div>
      )}

      {selectedClient && (
        <>
          {boardingsForDog.length > 1 && (
            <div className="mb-4 print:hidden">
              <label className="mb-1.5 block text-xs font-medium text-slate-500">
                Boarding stay
              </label>
              <select
                value={selectedBoardingId ?? ""}
                onChange={(e) => setSelectedBoardingId(e.target.value || null)}
                className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100">
                {boardingsForDog.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.start_date} → {b.end_date}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={() => {
              setSelectedClient(null);
              setMatches([]);
              setPhone("");
            }}
            className="mb-4 text-xs font-medium text-slate-400 hover:text-slate-600 print:hidden">
            ← Search a different number
          </button>

          <div className="print-header mb-5 hidden px-6 py-5 print:block">
            <h2 className="font-display text-2xl font-bold text-white">
              🐾 Lombard Doggy Daycare
            </h2>
            <p className="text-base font-medium text-white/90">
              Dog report — {selectedClient.dog_name}
            </p>
          </div>

          {loadingDetail ? (
            <p className="text-sm text-slate-500 print:hidden">Loading…</p>
          ) : (
            <div className="space-y-5">
              {/* Contact info */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Dog &amp; contact info
                </h3>
                <div className="flex items-start gap-4">
                  <div className="shrink-0">
                    {selectedClient.photo_data ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selectedClient.photo_data}
                        alt={`${selectedClient.dog_name}'s photo`}
                        className="h-20 w-20 rounded-xl object-cover print:h-24 print:w-24"
                      />
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-slate-100 text-2xl text-slate-300 print:hidden">
                        🐕
                      </div>
                    )}
                    <label className="mt-1.5 block cursor-pointer text-center text-[10px] font-medium text-accent-600 hover:text-accent-800 print:hidden">
                      {selectedClient.photo_data
                        ? "Change photo"
                        : "+ Add photo"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) =>
                          handleClientPhotoChange(selectedClient, e)
                        }
                      />
                    </label>
                  </div>
                  <div>
                    <p className="text-sm text-slate-800 font-medium">
                      <span className="font-extrabold">
                        {selectedClient.dog_name}
                      </span>{" "}
                      · Owner:{" "}
                      {selectedClient.drop_off_by || selectedClient.last_name}
                    </p>

                    {selectedClient.drop_off_by && (
                      <p className="text-sm text-slate-600 font-bold">
                        Emergency Contact:{" "}
                      </p>
                    )}
                    <p className="text-sm text-slate-600">
                      {selectedClient.drop_off_by}{" "}
                    </p>
                    <p className="text-sm text-slate-600">
                      {selectedClient.phone}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-400 print:hidden">
                      This photo shows on the kiosk sign-in/out page — parents
                      can see it but can&apos;t change it.
                    </p>
                  </div>
                </div>
              </section>

              {/* Stay details */}
              {selectedBoarding && (
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Stay
                  </h3>
                  <div className="flex items-start gap-3">
                    {selectedBoarding.photo_data && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selectedBoarding.photo_data}
                        alt={`${selectedClient.dog_name} during this stay`}
                        className="h-14 w-14 shrink-0 rounded-lg object-cover"
                      />
                    )}
                    <div>
                      <p className="text-sm text-slate-800">
                        {selectedBoarding.start_date} →{" "}
                        {selectedBoarding.end_date}
                      </p>
                      {selectedBoarding.feeding_instructions && (
                        <p className="mt-2 text-sm text-slate-600">
                          <span className="font-medium text-slate-700">
                            🍽️ Feeding instructions:
                          </span>{" "}
                          {selectedBoarding.feeding_instructions}
                        </p>
                      )}
                      {selectedBoarding.notes && (
                        <p className="mt-1 text-sm text-slate-600">
                          <span className="font-medium text-slate-700">
                            Notes:
                          </span>{" "}
                          {selectedBoarding.notes}
                        </p>
                      )}
                      {(selectedBoarding.addons ?? []).includes(
                        "medication",
                      ) && (
                        <p className="mt-1 text-sm text-slate-600">
                          <span className="font-medium text-slate-700">
                            💊 Medication:
                          </span>{" "}
                          {selectedBoarding.medication_instructions ||
                            "See staff for details"}
                        </p>
                      )}
                      {(selectedBoarding.addons ?? []).includes("walk") && (
                        <p className="mt-1 text-sm text-slate-600">
                          <span className="font-medium text-slate-700">
                            🚶 Walks requested:
                          </span>{" "}
                          {selectedBoarding.walks_per_day ?? 1} per day
                        </p>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {/* Walk log */}
              {selectedBoarding &&
                (selectedBoarding.addons ?? []).includes("walk") &&
                chartDays.length > 0 && (
                  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Walk log — {selectedBoarding.walks_per_day ?? 1}×/day
                    </h3>
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-1.5 pr-2 font-medium">Date</th>
                          {Array.from(
                            { length: selectedBoarding.walks_per_day ?? 1 },
                            (_, i) => (
                              <th key={i} className="py-1.5 px-2 font-medium">
                                Walk {i + 1} (in / out)
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {chartDays.map((day) => (
                          <tr
                            key={day}
                            className="border-b border-slate-100 text-slate-700">
                            <td className="py-1.5 pr-2">
                              {prettyDateKey(day)}
                            </td>
                            {Array.from(
                              { length: selectedBoarding.walks_per_day ?? 1 },
                              (_, i) => (
                                <td key={i} className="py-1.5 px-2">
                                  <span className="inline-block w-14 border-b border-dotted border-slate-300">
                                    &nbsp;
                                  </span>
                                  {" / "}
                                  <span className="inline-block w-14 border-b border-dotted border-slate-300">
                                    &nbsp;
                                  </span>
                                </td>
                              ),
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-2 text-[10px] text-slate-400 print:hidden">
                      Blank for staff to fill in by hand while walking, unless
                      logged on the records page.
                    </p>
                  </section>
                )}

              {/* Meal chart */}
              {selectedBoarding && chartDays.length > 0 && (
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Meal log
                  </h3>
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="py-1.5 pr-2 font-medium text-slate-500">
                          Date
                        </th>
                        {MEAL_TYPES.map((m) => (
                          <th
                            key={m.key}
                            className="py-1.5 px-2 text-center font-medium text-slate-500">
                            {m.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {chartDays.map((day) => (
                        <tr key={day} className="border-b border-slate-100">
                          <td className="py-1.5 pr-2 text-slate-700">
                            {prettyDateKey(day)}
                          </td>
                          {MEAL_TYPES.map((m) => {
                            const log = mealLogs.find(
                              (l) => l.date === day && l.meal_type === m.key,
                            );
                            const fed = !!log?.fed;
                            return (
                              <td
                                key={m.key}
                                className="py-1.5 px-2 text-center">
                                <button
                                  onClick={() => toggleMeal(day, m.key)}
                                  className={`inline-flex h-5 w-5 items-center justify-center rounded-md border text-[11px] print:border-slate-400 ${
                                    fed
                                      ? "border-emerald-500 bg-emerald-100 text-emerald-700"
                                      : "border-slate-200 bg-white text-transparent hover:border-slate-300"
                                  }`}>
                                  ✓
                                </button>
                                {fed && log?.fed_by && (
                                  <div className="mt-0.5 text-[9px] leading-none text-slate-400">
                                    {log.fed_by}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-[10px] text-slate-400 print:hidden">
                    Tap a box to mark a meal fed.
                  </p>
                </section>
              )}

              {/* Sign in/out times */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Sign in / out times
                </h3>
                {relevantSignins.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    No sign-in records{selectedBoarding ? " for this stay" : ""}
                    .
                  </p>
                ) : (
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-1.5 pr-2 font-medium">Date</th>
                        <th className="py-1.5 px-2 font-medium">Action</th>
                        <th className="py-1.5 px-2 font-medium">Time</th>
                        <th className="py-1.5 px-2 font-medium">By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {relevantSignins.map((s) => (
                        <tr
                          key={s.id}
                          className="border-b border-slate-100 text-slate-700">
                          <td className="py-1.5 pr-2">
                            {s.created_at?.slice(0, 10)}
                          </td>
                          <td className="py-1.5 px-2">
                            {s.action === "drop_off" ? "Drop off" : "Pick up"}
                          </td>
                          <td className="py-1.5 px-2">
                            {s.created_at &&
                              new Date(s.created_at).toLocaleTimeString(
                                undefined,
                                { hour: "numeric", minute: "2-digit" },
                              )}
                          </td>
                          <td className="py-1.5 px-2">
                            {s.drop_off_by || s.pick_up_by || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              {/* Add-ons + total */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {selectedBoarding ? "Charges" : "Add-ons"}
                </h3>
                {!selectedBoarding && (
                  <p className="text-sm text-slate-700">
                    {addonsUsed.length ? addonsUsed.join(", ") : "None"}
                  </p>
                )}
                {selectedBoarding && boardingEstimate && (
                  <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                    {boardingEstimate.breakdown.map((item, i) => (
                      <li key={i} className="flex justify-between">
                        <span>{item.label}</span>
                        <span>${item.amount.toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                  <span className="text-sm font-medium text-slate-700">
                    Total for{" "}
                    {selectedBoarding ? "the stay" : "charges on file"}
                  </span>
                  <span className="text-lg font-semibold text-emerald-700">
                    ${totalForStay.toFixed(2)}
                  </span>
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
