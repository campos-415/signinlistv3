"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { formatPhoneInput } from "@/lib/phone";
import { dateRange, prettyDateKey } from "@/lib/dates";
import { estimateBoardingTotal } from "@/lib/pricing";
import { dogHref } from "@/lib/dogs";
import { Boarding, Dog, MEAL_TYPES, MealLog, MealType, SignInRecord, WalkLog } from "@/types";
import { isStaffUnlocked, markStaffUnlocked } from "@/lib/staffAuth";
import StaffNav from "@/components/StaffNav";
import { useSettings } from "@/components/SettingsProvider";

const PASSCODE = process.env.NEXT_PUBLIC_RECORDS_PASSCODE;

export default function ReportPage() {
  const { settings } = useSettings();
  const business = settings.business;

  const [unlocked, setUnlocked] = useState(false);
  const [entered, setEntered] = useState("");
  const [error, setError] = useState("");

  const [phone, setPhone] = useState("");
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<Dog[]>([]);
  const [selectedDog, setSelectedDog] = useState<Dog | null>(null);

  const [boardingsForDog, setBoardingsForDog] = useState<Boarding[]>([]);
  const [selectedBoardingId, setSelectedBoardingId] = useState<string | null>(null);
  const [signins, setSignins] = useState<SignInRecord[]>([]);
  const [mealLogs, setMealLogs] = useState<MealLog[]>([]);
  const [walkLogs, setWalkLogs] = useState<WalkLog[]>([]);
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

  // Dogs on this number that actually have a stay — this report is about a
  // boarding reservation, so a daycare-only dog has nothing to show here
  // and is sent to its profile instead.
  const [dogsWithoutStays, setDogsWithoutStays] = useState<Dog[]>([]);

  async function searchPhone() {
    setSearching(true);
    setError("");
    try {
      const supabase = getSupabase();
      const [dogRes, boardingRes] = await Promise.all([
        supabase.from("dogs").select("*").eq("phone", phone.trim()),
        supabase.from("boardings").select("dog_name").eq("phone", phone.trim()),
      ]);
      if (dogRes.error) throw dogRes.error;
      if (boardingRes.error) throw boardingRes.error;

      const found = (dogRes.data as Dog[]) ?? [];
      const staying = new Set(
        ((boardingRes.data as { dog_name: string }[]) ?? []).map((b) => b.dog_name.trim().toLowerCase())
      );
      setMatches(found.filter((c) => staying.has(c.dog_name.trim().toLowerCase())));
      setDogsWithoutStays(found.filter((c) => !staying.has(c.dog_name.trim().toLowerCase())));
    } catch (e) {
      console.error("Dog search failed:", e);
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
        const { data: dogMatches } = await supabase
          .from("dogs")
          .select("*")
          .eq("phone", boarding.phone)
          .ilike("dog_name", boarding.dog_name);
        const dog: Dog =
          (dogMatches as Dog[] | null)?.[0] ??
          ({
            phone: boarding.phone,
            dog_name: boarding.dog_name,
            last_name: boarding.last_name,
            drop_off_by: "",
            signature_data: "",
          } as Dog);
        await selectDog(dog);
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

  async function selectDog(dog: Dog) {
    setSelectedDog(dog);
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
          .eq("dog_id", dog.id)
          .order("created_at", { ascending: true }),
        supabase
          .from("boardings")
          .select("*")
          .eq("phone", dog.phone)
          .ilike("dog_name", dog.dog_name)
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

  const selectedBoarding = useMemo(
    () => boardingsForDog.find((b) => b.id === selectedBoardingId) ?? null,
    [boardingsForDog, selectedBoardingId]
  );

  useEffect(() => {
    if (!selectedBoardingId) {
      setMealLogs([]);
      setWalkLogs([]);
      return;
    }
    (async () => {
      try {
        const supabase = getSupabase();
        const [mealRes, walkRes] = await Promise.all([
          supabase.from("meal_logs").select("*").eq("boarding_id", selectedBoardingId),
          supabase.from("walk_logs").select("*").eq("boarding_id", selectedBoardingId),
        ]);
        if (mealRes.error) throw mealRes.error;
        if (walkRes.error) throw walkRes.error;
        setMealLogs((mealRes.data as MealLog[]) ?? []);
        setWalkLogs((walkRes.data as WalkLog[]) ?? []);
      } catch (e) {
        console.error("Loading stay logs failed:", e);
      }
    })();
  }, [selectedBoardingId]);

  // Walk entries are saved per stay/day/slot as staff type them, the same
  // way the meal chart saves — the printed grid stays fillable by hand, but
  // anything entered here persists and shows on the dog's profile too.
  async function saveWalkField(
    day: string,
    walkIndex: number,
    field: "walk_out" | "walk_in" | "staff_initials",
    value: string
  ) {
    if (!selectedBoardingId) return;
    const trimmed = value.trim() || null;
    const existing = walkLogs.find((w) => w.date === day && w.walk_index === walkIndex);
    // Optimistic so the input doesn't fight the user between keystrokes.
    setWalkLogs((prev) => {
      const rest = prev.filter((w) => !(w.date === day && w.walk_index === walkIndex));
      return [
        ...rest,
        {
          ...(existing ?? { boarding_id: selectedBoardingId, date: day, walk_index: walkIndex }),
          [field]: trimmed,
        } as WalkLog,
      ];
    });
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase.from("walk_logs").upsert(
        {
          boarding_id: selectedBoardingId,
          date: day,
          walk_index: walkIndex,
          walk_out: field === "walk_out" ? trimmed : (existing?.walk_out ?? null),
          walk_in: field === "walk_in" ? trimmed : (existing?.walk_in ?? null),
          staff_initials: field === "staff_initials" ? trimmed : (existing?.staff_initials ?? null),
        },
        { onConflict: "boarding_id,date,walk_index" }
      );
      if (err) throw err;
    } catch (e) {
      console.error("Saving walk log failed:", e);
      setError("Could not save the walk log.");
    }
  }

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
        <h1 className="font-display text-xl font-semibold text-ink">Staff stay report</h1>
        <input
          type="password"
          value={entered}
          onChange={(e) => setEntered(e.target.value)}
          placeholder="Passcode"
          onKeyDown={(e) => e.key === "Enter" && checkPasscode()}
          className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
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
            background: linear-gradient(135deg, rgb(var(--print-from)) 0%, rgb(var(--print-to)) 100%);
            border-radius: 20px;
          }
        }
      `}</style>

      <StaffNav current="/report" />

      <div className="mb-6 flex items-center justify-between print:hidden">
        <h1 className="font-display text-xl font-semibold text-ink">
          Boarding stay report
        </h1>
        {selectedDog && (
          <button
            onClick={() => window.print()}
            className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow-card hover:bg-accent-600">
            🖨️ Print / Save as PDF
          </button>
        )}
      </div>

      {!selectedDog && (
        <div className="print:hidden">
          <div className="mb-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
            <label className="mb-1.5 block text-xs font-medium text-ink-3">
              Search by phone number
            </label>
            <input
              value={phone}
              onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
              placeholder="(123) 456-7890"
              inputMode="numeric"
              className="w-full rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
            />
            {searching && (
              <p className="mt-2 text-xs text-ink-3">Searching…</p>
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
                  onClick={() => selectDog(c)}
                  className="flex w-full items-center justify-between rounded-2xl border border-line bg-surface px-5 py-3.5 text-left shadow-card hover:border-accent-300">
                  <span className="text-sm font-medium text-ink">
                    🐕 {c.dog_name}{" "}
                    <span className="font-normal text-ink-3">
                      · {c.last_name}
                    </span>
                  </span>
                  <span className="text-xs text-ink-3">{c.phone}</span>
                </button>
              ))}
            </div>
          )}
          {/* Dogs on the number with no stay can't have a stay report —
              point staff at the profile, which is where their daycare
              history and details live. */}
          {!searching && dogsWithoutStays.length > 0 && (
            <div className="mt-3 rounded-2xl border border-line bg-surface-2 px-4 py-3">
              <p className="text-xs font-medium text-ink-3">No boarding stay on file</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {dogsWithoutStays.map((c) => (
                  <Link
                    key={c.id}
                    href={c.id ? dogHref(c.id) : "#"}
                    className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink-2 hover:border-accent-300"
                  >
                    🐕 {c.dog_name} — open profile →
                  </Link>
                ))}
              </div>
            </div>
          )}

          {!searching &&
            phone.replace(/\D/g, "").length >= 7 &&
            matches.length === 0 &&
            dogsWithoutStays.length === 0 && (
              <p className="text-sm text-ink-3">
                No dog on file for that number.
              </p>
            )}
        </div>
      )}

      {selectedDog && (
        <>
          {boardingsForDog.length > 1 && (
            <div className="mb-4 print:hidden">
              <label className="mb-1.5 block text-xs font-medium text-ink-3">
                Boarding stay
              </label>
              <select
                value={selectedBoardingId ?? ""}
                onChange={(e) => setSelectedBoardingId(e.target.value || null)}
                className="rounded-xl border border-line bg-surface px-3.5 py-2 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100">
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
              setSelectedDog(null);
              setMatches([]);
              setPhone("");
            }}
            className="mb-4 text-xs font-medium text-ink-3 hover:text-ink-2 print:hidden">
            ← Search a different number
          </button>

          <div className="print-header mb-5 hidden px-6 py-5 print:block">
            <h2 className="font-display text-2xl font-bold text-white">
              🐾 {business.name}
            </h2>
            <p className="text-base font-medium text-white/90">
              Boarding stay — {selectedDog.dog_name}
              {selectedBoarding && (
                <>
                  {" · "}
                  {prettyDateKey(selectedBoarding.start_date)} →{" "}
                  {prettyDateKey(selectedBoarding.end_date)}
                </>
              )}
            </p>
          </div>

          {loadingDetail ? (
            <p className="text-sm text-ink-3 print:hidden">Loading…</p>
          ) : (
            <div className="space-y-5">
              {/* Who the stay is for. Read-only — the dog's details, photo,
                  vaccines, and history all live on its profile now. */}
              <section className="rounded-2xl border border-line bg-surface p-5 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none">
                <div className="flex items-center gap-4">
                  {selectedDog.photo_data ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selectedDog.photo_data}
                      alt={`${selectedDog.dog_name}'s photo`}
                      className="h-16 w-16 shrink-0 rounded-xl object-cover print:h-20 print:w-20"
                    />
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-2xl text-ink-3 print:hidden">
                      🐕
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-lg font-semibold text-ink">{selectedDog.dog_name}</p>
                    <p className="text-sm text-ink-2">
                      {selectedDog.last_name} · {selectedDog.phone}
                    </p>
                    {selectedDog.id && (
                      <Link
                        href={dogHref(selectedDog.id)}
                        className="text-xs font-medium text-accent-600 hover:underline print:hidden"
                      >
                        Full profile, vaccines &amp; history →
                      </Link>
                    )}
                  </div>
                </div>
              </section>

              {/* Stay details */}
              {selectedBoarding && (
                <section className="rounded-2xl border border-line bg-surface p-5 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
                    Stay
                  </h3>
                  <div className="flex items-start gap-3">
                    {selectedBoarding.photo_data && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selectedBoarding.photo_data}
                        alt={`${selectedDog.dog_name} during this stay`}
                        className="h-14 w-14 shrink-0 rounded-lg object-cover"
                      />
                    )}
                    <div>
                      <p className="text-sm text-ink">
                        {selectedBoarding.start_date} →{" "}
                        {selectedBoarding.end_date}
                      </p>
                      {selectedBoarding.feeding_instructions && (
                        <p className="mt-2 text-sm text-ink-2">
                          <span className="font-medium text-ink-2">
                            🍽️ Feeding instructions:
                          </span>{" "}
                          {selectedBoarding.feeding_instructions}
                        </p>
                      )}
                      {selectedBoarding.notes && (
                        <p className="mt-1 text-sm text-ink-2">
                          <span className="font-medium text-ink-2">
                            Notes:
                          </span>{" "}
                          {selectedBoarding.notes}
                        </p>
                      )}
                      {(selectedBoarding.addons ?? []).includes(
                        "medication",
                      ) && (
                        <p className="mt-1 text-sm text-ink-2">
                          <span className="font-medium text-ink-2">
                            💊 Medication:
                          </span>{" "}
                          {selectedBoarding.medication_instructions ||
                            "See staff for details"}
                        </p>
                      )}
                      {(selectedBoarding.addons ?? []).includes("walk") && (
                        <p className="mt-1 text-sm text-ink-2">
                          <span className="font-medium text-ink-2">
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
                  <section className="rounded-2xl border border-line bg-surface p-5 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
                      Walk log — {selectedBoarding.walks_per_day ?? 1}×/day
                    </h3>
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-line text-ink-3">
                          <th className="py-1.5 pr-2 font-medium">Date</th>
                          {Array.from(
                            { length: selectedBoarding.walks_per_day ?? 1 },
                            (_, i) => (
                              <th key={i} className="py-1.5 px-2 font-medium">
                                Walk {i + 1} — out / back / by
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {chartDays.map((day) => (
                          <tr
                            key={day}
                            className="border-b border-line-soft text-ink-2">
                            <td className="py-1.5 pr-2 whitespace-nowrap">
                              {prettyDateKey(day)}
                            </td>
                            {Array.from(
                              { length: selectedBoarding.walks_per_day ?? 1 },
                              (_, i) => {
                                const entry = walkLogs.find(
                                  (w) => w.date === day && w.walk_index === i,
                                );
                                return (
                                  <td key={i} className="py-1.5 px-2">
                                    <div className="flex items-center gap-1">
                                      <WalkInput
                                        entryKey={`${day}-${i}-out`}
                                        value={entry?.walk_out ?? ""}
                                        placeholder="out"
                                        onSave={(v) => saveWalkField(day, i, "walk_out", v)}
                                      />
                                      <WalkInput
                                        entryKey={`${day}-${i}-in`}
                                        value={entry?.walk_in ?? ""}
                                        placeholder="back"
                                        onSave={(v) => saveWalkField(day, i, "walk_in", v)}
                                      />
                                      <WalkInput
                                        entryKey={`${day}-${i}-by`}
                                        value={entry?.staff_initials ?? ""}
                                        placeholder="by"
                                        width="w-10"
                                        onSave={(v) => saveWalkField(day, i, "staff_initials", v)}
                                      />
                                    </div>
                                  </td>
                                );
                              },
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-2 text-[10px] text-ink-3 print:hidden">
                      Saves as you type. Anything left blank prints as a line to
                      fill in by hand.
                    </p>
                  </section>
                )}

              {/* Meal chart */}
              {selectedBoarding && chartDays.length > 0 && (
                <section className="rounded-2xl border border-line bg-surface p-5 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
                    Meal log
                  </h3>
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-line">
                        <th className="py-1.5 pr-2 font-medium text-ink-3">
                          Date
                        </th>
                        {MEAL_TYPES.map((m) => (
                          <th
                            key={m.key}
                            className="py-1.5 px-2 text-center font-medium text-ink-3">
                            {m.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {chartDays.map((day) => (
                        <tr key={day} className="border-b border-line-soft">
                          <td className="py-1.5 pr-2 text-ink-2">
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
                                      : "border-line bg-surface text-transparent hover:border-line"
                                  }`}>
                                  ✓
                                </button>
                                {fed && log?.fed_by && (
                                  <div className="mt-0.5 text-[9px] leading-none text-ink-3">
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
                  <p className="mt-2 text-[10px] text-ink-3 print:hidden">
                    Tap a box to mark a meal fed.
                  </p>
                </section>
              )}

              {/* Sign in/out times */}
              <section className="rounded-2xl border border-line bg-surface p-5 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
                  Sign in / out times
                </h3>
                {relevantSignins.length === 0 ? (
                  <p className="text-sm text-ink-3">
                    No sign-in records{selectedBoarding ? " for this stay" : ""}
                    .
                  </p>
                ) : (
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-line text-ink-3">
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
                          className="border-b border-line-soft text-ink-2">
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
              <section className="rounded-2xl border border-line bg-surface p-5 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
                  {selectedBoarding ? "Charges" : "Add-ons"}
                </h3>
                {!selectedBoarding && (
                  <p className="text-sm text-ink-2">
                    {addonsUsed.length ? addonsUsed.join(", ") : "None"}
                  </p>
                )}
                {selectedBoarding && boardingEstimate && (
                  <ul className="mt-1 space-y-0.5 text-xs text-ink-3">
                    {boardingEstimate.breakdown.map((item, i) => (
                      <li key={i} className="flex justify-between">
                        <span>{item.label}</span>
                        <span>${item.amount.toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 flex items-center justify-between border-t border-line-soft pt-3">
                  <span className="text-sm font-medium text-ink-2">
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

// Uncontrolled so typing never fights a re-render, saving on blur. The
// `key` the caller passes resets it when the stay changes. In print it
// collapses to a dotted line so a half-filled log is still writable by hand.
function WalkInput({
  entryKey,
  value,
  placeholder,
  width = "w-14",
  onSave,
}: {
  entryKey: string;
  value: string;
  placeholder: string;
  width?: string;
  onSave: (value: string) => void;
}) {
  return (
    <input
      key={entryKey}
      defaultValue={value}
      placeholder={placeholder}
      onBlur={(e) => {
        if (e.target.value.trim() !== value.trim()) onSave(e.target.value);
      }}
      className={`${width} rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] outline-none focus:border-accent-500 print:w-12 print:rounded-none print:border-0 print:border-b print:border-dotted print:border-slate-400 print:bg-transparent print:p-0 print:placeholder:text-transparent`}
    />
  );
}
