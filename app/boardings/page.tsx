"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { formatPhoneInput } from "@/lib/phone";
import { dateKey, parseDateKey, prettyDateKey, todayKey } from "@/lib/dates";
import { estimateBoardingTotal } from "@/lib/pricing";
import { BathSize, Boarding, BOARDING_ADDONS, BoardingAddonKey, Dog } from "@/types";
import { dogHref } from "@/lib/dogs";
import { isStaffUnlocked, markStaffUnlocked } from "@/lib/staffAuth";
import { fileToResizedDataUrl } from "@/lib/image";
import StaffNav from "@/components/StaffNav";
import DateField from "@/components/DateField";

const PASSCODE = process.env.NEXT_PUBLIC_RECORDS_PASSCODE;

// What's shared by every dog on one booking — the family drops off and
// picks up together, so the phone and dates are entered once.
interface FormState {
  phone: string;
  start_date: string;
  end_date: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  phone: "",
  start_date: todayKey(),
  end_date: todayKey(),
  notes: "",
};

// A dog picked from the phone lookup. `key` is the client id, or the
// MANUAL_KEY sentinel when editing an older reservation whose client
// profile is gone (or was created before reservations stored dog_id).
interface SelectedDog {
  key: string;
  dog_name: string;
  last_name: string;
  dog_id: string | null;
  profile_photo: string | null; // the dog's profile photo from clients, for recognition
}

const MANUAL_KEY = "__manual__";

// Everything that varies dog to dog. Two dogs on the same booking often
// want different add-ons, food, and walk counts, so none of this can be
// shared across the booking the way the dates are.
interface DogConfig {
  addons: BoardingAddonKey[];
  walks_per_day: number;
  bath_size: BathSize | "";
  medication_instructions: string;
  feeding_instructions: string;
  photo_data: string; // base64 data URL, empty string if no photo
}

const EMPTY_DOG_CONFIG: DogConfig = {
  addons: [],
  walks_per_day: 1,
  bath_size: "",
  medication_instructions: "",
  feeding_instructions: "",
  photo_data: "",
};

// Muted, print-friendly-ish palette cycled per reservation on the
// calendar so overlapping stays stay visually distinct.
// A dog with an approved meet & greet booked. Not a reservation row — the
// date lives on the dog itself, set by the enrollment form.
interface MeetGreet {
  id: string;
  dog_name: string;
  last_name: string;
  phone: string;
  meet_greet_on: string;
  meet_greet_window: string | null;
}

type CalView = "all" | "boardings" | "meets";

const CAL_VIEWS: { key: CalView; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "boardings", label: "🛏️ Boardings" },
  { key: "meets", label: "✨ Meet & greets" },
];

const PILL_COLORS = [
  "bg-accent-100 text-accent-800 border-accent-200",
  "bg-emerald-100 text-emerald-800 border-emerald-200",
  "bg-amber-100 text-amber-800 border-amber-200",
  "bg-rose-100 text-rose-800 border-rose-200",
  "bg-violet-100 text-violet-800 border-violet-200",
  "bg-sky-100 text-sky-800 border-sky-200",
];

export default function BoardingsPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [entered, setEntered] = useState("");
  const [error, setError] = useState("");
  const [boardings, setBoardings] = useState<Boarding[]>([]);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Dogs on file for the phone number typed into the form — staff pick
  // which ones are boarding instead of retyping names by hand. Mirrors
  // the kiosk's lookup + multi-dog picker (see components/KioskForm.tsx).
  const [dogMatches, setDogMatches] = useState<Dog[]>([]);
  const [dogsLoading, setDogsLoading] = useState(false);
  const [dogsChecked, setDogsChecked] = useState(false);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedDogs, setSelectedDogs] = useState<SelectedDog[]>([]);
  const [configByDog, setConfigByDog] = useState<Record<string, DogConfig>>({});

  // Calendar month currently shown — defaults to this month.
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  // Approved meet & greets, which live as a date on the dog rather than as
  // a reservation row. Shown on the same calendar so staff have one place
  // to see what the day holds.
  const [meets, setMeets] = useState<MeetGreet[]>([]);
  const [calView, setCalView] = useState<CalView>("all");

  useEffect(() => {
    if (isStaffUnlocked()) setUnlocked(true);
  }, []);

  useEffect(() => {
    if (unlocked) load();
  }, [unlocked]);

  useEffect(() => {
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    // Whatever was picked belonged to the previous number. Editing is
    // pinned to one existing reservation, so its selection stays put —
    // the lookup still runs to resolve that dog's profile photo.
    if (!editingId) {
      setSelectedDogs([]);
      setConfigByDog({});
    }
    const digits = form.phone.replace(/\D/g, "");
    if (digits.length < 7) {
      setDogMatches([]);
      setDogsChecked(false);
      return;
    }
    lookupTimer.current = setTimeout(async () => {
      setDogsLoading(true);
      try {
        const supabase = getSupabase();
        const { data, error: err } = await supabase
          .from("dogs")
          .select("*")
          .eq("phone", form.phone.trim())
          .order("created_at", { ascending: true });
        if (err) throw err;
        const found = (data as Dog[]) ?? [];
        setDogMatches(found);
        if (editingId) {
          // Backfill the pinned dog's photo now that its profile is loaded.
          setSelectedDogs((prev) =>
            prev.map((d) => {
              const match = found.find(
                (c) => c.dog_name.trim().toLowerCase() === d.dog_name.trim().toLowerCase()
              );
              return match ? { ...d, profile_photo: match.photo_data ?? null } : d;
            })
          );
        } else if (found.length === 1) {
          // A single dog on file selects itself — with several, staff pick
          // which ones are boarding together.
          toggleDog(found[0]);
        }
      } catch (e) {
        console.error("Dog lookup failed:", e);
      } finally {
        setDogsLoading(false);
        setDogsChecked(true);
      }
    }, 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.phone]);

  async function load() {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data, error: err } = await supabase
        .from("boardings")
        .select("*")
        .order("start_date", { ascending: true });
      if (err) throw err;
      setBoardings((data as Boarding[]) ?? []);

      // Non-fatal: reservations are the point of this page, and an install
      // that has not run the meet-and-greet migration yet should still get
      // its calendar rather than an error.
      //
      // Only the columns the calendar needs — `clients` rows carry photo
      // and document data that would be pointless to pull here.
      try {
        const { data: meetData, error: meetErr } = await supabase
          .from("dogs")
          .select("id, dog_name, last_name, phone, meet_greet_on, meet_greet_window")
          .not("meet_greet_on", "is", null)
          .order("meet_greet_on", { ascending: true });
        if (meetErr) throw meetErr;
        setMeets((meetData as MeetGreet[]) ?? []);
      } catch (e) {
        console.error("Loading meet & greets failed:", e);
      }
    } catch (e) {
      console.error("Loading boardings failed:", e);
      setError("Could not load boarding reservations.");
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

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setDogMatches([]);
    setDogsChecked(false);
    setSelectedDogs([]);
    setConfigByDog({});
  }

  function configFor(key: string): DogConfig {
    return configByDog[key] ?? EMPTY_DOG_CONFIG;
  }

  function updateConfig(key: string, patch: Partial<DogConfig>) {
    setConfigByDog((prev) => ({ ...prev, [key]: { ...(prev[key] ?? EMPTY_DOG_CONFIG), ...patch } }));
  }

  // Adds/removes a dog from this booking. Each dog keeps its own add-on
  // config, seeded blank the first time it's picked.
  function toggleDog(c: Dog) {
    const key = c.id ?? c.dog_name;
    setSelectedDogs((prev) => {
      if (prev.some((d) => d.key === key)) return prev.filter((d) => d.key !== key);
      return [
        ...prev,
        {
          key,
          dog_name: c.dog_name,
          last_name: c.last_name,
          dog_id: c.id ?? null,
          profile_photo: c.photo_data ?? null,
        },
      ];
    });
    setConfigByDog((prev) => (prev[key] ? prev : { ...prev, [key]: EMPTY_DOG_CONFIG }));
  }

  function toggleDogAddon(key: string, addon: BoardingAddonKey) {
    const current = configFor(key).addons;
    updateConfig(key, {
      addons: current.includes(addon) ? current.filter((a) => a !== addon) : [...current, addon],
    });
  }

  // Editing works on one existing reservation at a time — it maps to a
  // single boardings row, so the picker collapses to just that dog.
  function startEdit(b: Boarding) {
    setEditingId(b.id ?? null);
    const key = b.dog_id ?? MANUAL_KEY;
    setForm({
      phone: b.phone,
      start_date: b.start_date,
      end_date: b.end_date,
      notes: b.notes ?? "",
    });
    setSelectedDogs([
      {
        key,
        dog_name: b.dog_name,
        last_name: b.last_name,
        dog_id: b.dog_id ?? null,
        // Filled in by the lookup effect below once the client is found.
        profile_photo: null,
      },
    ]);
    setConfigByDog({
      [key]: {
        addons: b.addons ?? [],
        walks_per_day: b.walks_per_day ?? 1,
        bath_size: b.bath_size ?? "",
        medication_instructions: b.medication_instructions ?? "",
        feeding_instructions: b.feeding_instructions ?? "",
        photo_data: b.photo_data ?? "",
      },
    });
  }

  async function handlePhotoChange(key: string, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    try {
      const dataUrl = await fileToResizedDataUrl(file);
      updateConfig(key, { photo_data: dataUrl });
    } catch (err) {
      console.error("Reading photo failed:", err);
      setError("Could not read that photo — try a different file.");
    }
  }

  // Builds the boardings row for one dog — its own add-ons, food, and
  // photo, plus the phone/dates shared across the booking.
  function payloadFor(dog: SelectedDog) {
    const cfg = configFor(dog.key);
    return {
      dog_name: dog.dog_name.trim(),
      last_name: dog.last_name.trim(),
      phone: form.phone.trim(),
      dog_id: dog.dog_id,
      start_date: form.start_date,
      end_date: form.end_date,
      feeding_instructions: cfg.feeding_instructions.trim() || null,
      notes: form.notes.trim() || null,
      addons: cfg.addons,
      walks_per_day: cfg.addons.includes("walk") ? Math.max(1, cfg.walks_per_day) : null,
      bath_size: cfg.addons.includes("bath") && cfg.bath_size ? cfg.bath_size : null,
      medication_instructions: cfg.addons.includes("medication")
        ? cfg.medication_instructions.trim() || null
        : null,
      photo_data: cfg.photo_data || null,
    };
  }

  async function saveBoarding() {
    if (!form.phone.trim() || !form.start_date || !form.end_date) {
      setError("Enter a phone number and both dates.");
      return;
    }
    if (selectedDogs.length === 0) {
      setError("Pick which dog (or dogs) this reservation is for.");
      return;
    }
    if (form.end_date < form.start_date) {
      setError("End date can't be before the start date.");
      return;
    }
    if (conflicts.length) {
      setError(
        `${conflicts.map((d) => d.dog_name).join(", ")} already ${
          conflicts.length > 1 ? "have reservations" : "has a reservation"
        } overlapping these dates — edit the existing one instead of booking a duplicate.`
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      const supabase = getSupabase();
      if (editingId) {
        const { error: err } = await supabase.from("boardings").update(payloadFor(selectedDogs[0])).eq("id", editingId);
        if (err) throw err;
      } else {
        // One row per dog — each dog's stay is tracked, printed, and
        // priced separately even though they were booked together.
        const { error: err } = await supabase.from("boardings").insert(selectedDogs.map(payloadFor));
        if (err) throw err;
      }
      resetForm();
      load();
    } catch (e) {
      console.error("Saving boarding failed:", e);
      setError("Could not save the reservation.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteBoarding(b: Boarding) {
    if (!b.id) return;
    if (!window.confirm(`Delete the boarding reservation for ${b.dog_name} (${b.start_date} → ${b.end_date})? This can't be undone.`)) {
      return;
    }
    setDeletingId(b.id);
    setError("");
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase.from("boardings").delete().eq("id", b.id);
      if (err) throw err;
      if (editingId === b.id) resetForm();
      load();
    } catch (e) {
      console.error("Deleting boarding failed:", e);
      setError("Could not delete the reservation.");
    } finally {
      setDeletingId(null);
    }
  }

  // An existing reservation for this dog whose dates overlap the ones
  // being entered — two stays for the same dog can't run at once, so this
  // blocks the booking rather than quietly creating a duplicate. Matches
  // on dog_id when the reservation has one, falling back to
  // dog name + phone for rows created before dog_id was stored.
  function conflictingBoardingFor(dog: SelectedDog): Boarding | null {
    if (!form.start_date || !form.end_date) return null;
    return (
      boardings.find((b) => {
        if (b.id && b.id === editingId) return false; // the row being edited
        const sameDog = b.dog_id && dog.dog_id
          ? b.dog_id === dog.dog_id
          : b.dog_name.trim().toLowerCase() === dog.dog_name.trim().toLowerCase() &&
            b.phone.replace(/\D/g, "") === form.phone.replace(/\D/g, "");
        if (!sameDog) return false;
        return b.start_date <= form.end_date && b.end_date >= form.start_date;
      }) ?? null
    );
  }

  const conflicts = useMemo(
    () => selectedDogs.filter((d) => conflictingBoardingFor(d) !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedDogs, boardings, form.start_date, form.end_date, form.phone, editingId]
  );

  // Combined estimate across every dog on this booking — null while the
  // dates are incomplete or backwards, since there's nothing to price.
  const bookingTotal = useMemo(() => {
    if (!form.start_date || !form.end_date || form.end_date < form.start_date) return null;
    return selectedDogs.reduce((sum, dog) => {
      const cfg = configByDog[dog.key] ?? EMPTY_DOG_CONFIG;
      return (
        sum +
        estimateBoardingTotal(form.start_date, form.end_date, {
          addons: cfg.addons,
          walksPerDay: cfg.walks_per_day,
          bathSize: cfg.bath_size || null,
        }).amount
      );
    }, 0);
  }, [form.start_date, form.end_date, selectedDogs, configByDog]);

  const upcoming = useMemo(() => {
    const today = todayKey();
    return boardings
      .filter((b) => b.end_date >= today)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
  }, [boardings]);

  const past = useMemo(() => {
    const today = todayKey();
    return boardings
      .filter((b) => b.end_date < today)
      .sort((a, b) => b.start_date.localeCompare(a.start_date));
  }, [boardings]);

  // Stable color per reservation id so the same stay keeps its color
  // across the month grid and the list below.
  const colorFor = useMemo(() => {
    const map = new Map<string, string>();
    boardings.forEach((b, i) => {
      if (b.id) map.set(b.id, PILL_COLORS[i % PILL_COLORS.length]);
    });
    return map;
  }, [boardings]);

  // 6x7 calendar grid for calMonth, padded with the trailing days of
  // the previous/next month so every week row is full.
  const calendarDays = useMemo(() => {
    const firstOfMonth = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1);
    const startPad = firstOfMonth.getDay(); // 0 = Sunday
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(gridStart.getDate() - startPad);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
  }, [calMonth]);

  function boardingsOn(day: string): Boarding[] {
    if (calView === "meets") return [];
    return boardings.filter((b) => b.start_date <= day && b.end_date >= day);
  }

  function meetsOn(day: string): MeetGreet[] {
    if (calView === "boardings") return [];
    return meets.filter((m) => m.meet_greet_on === day);
  }

  const monthLabel = calMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const today = todayKey();
  const selectedDayBoardings = selectedDay ? boardingsOn(selectedDay) : [];
  const selectedDayMeets = selectedDay ? meetsOn(selectedDay) : [];

  if (!unlocked) {
    return (
      <div className="mx-auto mt-28 flex max-w-xs flex-col gap-3 px-5">
        <h1 className="font-display text-xl font-semibold text-ink">Staff boarding</h1>
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
    <div className="mx-auto max-w-5xl px-6 py-10">
      <StaffNav current="/boardings" />
      <h1 className="font-display mb-6 text-xl font-semibold text-ink">Boarding reservations</h1>

      <div className="mb-8 rounded-2xl border border-line bg-surface p-5 shadow-card">
        <p className="mb-4 text-sm font-medium text-ink-2">
          {editingId ? "Edit reservation" : "Add a new reservation"}
        </p>
        {/* Dog lookup — staff type the phone number, then pick the dog
            from what's already on file instead of retyping names. */}
        <div className="mb-3">
          <label className="mb-1 block text-[11px] text-ink-3">Phone number</label>
          <input
            value={form.phone}
            onChange={(e) =>
              setForm({
                ...form,
                phone: formatPhoneInput(e.target.value),
              })
            }
            placeholder="(123) 456-7890"
            inputMode="numeric"
            className="w-full max-w-xs rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
          />

          {dogsLoading && <p className="mt-2 text-xs text-ink-3">Looking up…</p>}

          {!dogsLoading && dogsChecked && dogMatches.length === 0 && (
            <p className="mt-2 text-xs text-amber-700">
              No dog on file for that number — the client needs an approved enrollment first.
            </p>
          )}

          {editingId && selectedDogs.length > 0 && (
            <p className="mt-2 text-xs text-ink-3">
              Editing {selectedDogs[0].dog_name}&apos;s reservation · {selectedDogs[0].last_name}
            </p>
          )}

          {!editingId && dogMatches.length > 0 && (
            <div className="mt-2">
              <p className="mb-1 text-[11px] text-ink-3">
                {dogMatches.length === 1
                  ? "Dog on file"
                  : "Which dog (or dogs)? Tap all that are boarding together."}
              </p>
              <div className="flex flex-wrap gap-2">
                {dogMatches.map((c) => {
                  const key = c.id ?? c.dog_name;
                  const selected = selectedDogs.some((d) => d.key === key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleDog(c)}
                      className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3.5 text-xs font-medium transition ${
                        selected
                          ? "border-accent-500 bg-accent-500 text-white"
                          : "border-accent-200 bg-surface text-accent-700 hover:border-accent-400"
                      }`}
                    >
                      {c.photo_data ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.photo_data}
                          alt={`${c.dog_name}'s photo`}
                          className="h-7 w-7 rounded-full object-cover ring-1 ring-white/60"
                        />
                      ) : (
                        <span
                          className={`flex h-7 w-7 items-center justify-center rounded-full text-sm ${
                            selected ? "bg-white/20" : "bg-accent-50"
                          }`}
                        >
                          🐕
                        </span>
                      )}
                      {selected ? "✓ " : ""}
                      {c.dog_name} · {c.last_name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-[11px] text-ink-3">Drop-off date</label>
            <DateField
              value={form.start_date}
              onChange={(v) => setForm({ ...form, start_date: v })}
              className="w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
              ariaLabel="Drop-off date"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-ink-3">Pick-up date</label>
            <DateField
              value={form.end_date}
              onChange={(v) => setForm({ ...form, end_date: v })}
              className="w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
              ariaLabel="Pick-up date"
            />
          </div>
          <input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Notes (optional)"
            className="rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
          />
        </div>

        {/* Per-dog add-ons, food, and photo — one card per selected dog,
            since two dogs on the same booking rarely want the same thing. */}
        {selectedDogs.length > 0 && (
          <div className="mt-4 space-y-3 border-t border-line-soft pt-4">
            {selectedDogs.map((dog) => {
              const cfg = configFor(dog.key);
              const datesValid = form.start_date && form.end_date && form.end_date >= form.start_date;
              const dogTotal = datesValid
                ? estimateBoardingTotal(form.start_date, form.end_date, {
                    addons: cfg.addons,
                    walksPerDay: cfg.walks_per_day,
                    bathSize: cfg.bath_size || null,
                  }).amount
                : 0;
              const conflict = conflictingBoardingFor(dog);
              return (
                <div
                  key={dog.key}
                  className={`rounded-2xl border p-4 ${
                    conflict ? "border-rose-200 bg-rose-50/60" : "border-line bg-surface-2/60"
                  }`}
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      {dog.profile_photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={dog.profile_photo}
                          alt={`${dog.dog_name}'s photo`}
                          className="h-10 w-10 rounded-full object-cover ring-2 ring-white"
                        />
                      ) : (
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-lg ring-2 ring-white">
                          🐕
                        </span>
                      )}
                      <p className="text-sm font-medium text-ink">
                        {dog.dog_name} <span className="font-normal text-ink-3">· {dog.last_name}</span>
                      </p>
                    </div>
                    {datesValid && (
                      <span className="text-xs font-medium text-emerald-700">${dogTotal.toFixed(2)}</span>
                    )}
                  </div>

                  {conflict && (
                    <p className="mb-2 rounded-lg bg-rose-100 px-2.5 py-1.5 text-xs font-medium text-rose-700">
                      🛏️ {dog.dog_name} already has a reservation for {conflict.start_date} →{" "}
                      {conflict.end_date}, which overlaps these dates. Edit that one instead of booking a
                      duplicate.
                    </p>
                  )}

                  <label className="mb-1.5 block text-[11px] text-ink-3">Add-ons for {dog.dog_name}</label>
                  <div className="flex flex-wrap gap-2">
                    {BOARDING_ADDONS.map((a) => (
                      <button
                        key={a.key}
                        type="button"
                        onClick={() => toggleDogAddon(dog.key, a.key)}
                        className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                          cfg.addons.includes(a.key)
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                            : "border-line bg-surface text-ink-3 hover:border-line"
                        }`}
                      >
                        {a.icon} {a.label}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {cfg.addons.includes("walk") && (
                      <div>
                        <label className="mb-1 block text-[11px] text-ink-3">Walks per day</label>
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={cfg.walks_per_day}
                          onChange={(e) =>
                            updateConfig(dog.key, { walks_per_day: Math.max(1, Number(e.target.value) || 1) })
                          }
                          className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
                        />
                      </div>
                    )}
                    {cfg.addons.includes("bath") && (
                      <div>
                        <label className="mb-1 block text-[11px] text-ink-3">Bath size</label>
                        <select
                          value={cfg.bath_size}
                          onChange={(e) => updateConfig(dog.key, { bath_size: e.target.value as BathSize | "" })}
                          className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
                        >
                          <option value="">Select size…</option>
                          <option value="S">Small</option>
                          <option value="M">Medium</option>
                          <option value="L">Large</option>
                        </select>
                      </div>
                    )}
                    {cfg.addons.includes("medication") && (
                      <div className="sm:col-span-3">
                        <label className="mb-1 block text-[11px] text-ink-3">
                          Medication instructions (dosage, timing — shown on the printed report)
                        </label>
                        <textarea
                          value={cfg.medication_instructions}
                          onChange={(e) => updateConfig(dog.key, { medication_instructions: e.target.value })}
                          rows={2}
                          className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
                        />
                      </div>
                    )}
                    <textarea
                      value={cfg.feeding_instructions}
                      onChange={(e) => updateConfig(dog.key, { feeding_instructions: e.target.value })}
                      placeholder={`Feeding instructions for ${dog.dog_name} (shown on the printed report)`}
                      rows={2}
                      className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100 sm:col-span-3"
                    />
                  </div>

                </div>
              );
            })}

            {selectedDogs.length > 1 && bookingTotal !== null && (
              <p className="text-xs font-medium text-ink-3">
                Estimated total for {selectedDogs.length} dogs:{" "}
                <span className="text-emerald-700">${bookingTotal.toFixed(2)}</span>
              </p>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={saveBoarding}
            disabled={saving || conflicts.length > 0}
            className="rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-medium text-white shadow-card hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving
              ? "Saving…"
              : conflicts.length > 0
                ? "Already booked"
                : editingId
                  ? "Save changes"
                  : selectedDogs.length > 1
                    ? `Add ${selectedDogs.length} reservations`
                    : "Add reservation"}
          </button>
          {editingId && (
            <button
              onClick={resetForm}
              className="rounded-xl border border-line px-5 py-2.5 text-sm text-ink-3 hover:border-line"
            >
              Cancel
            </button>
          )}
        </div>
        {error && <p className="mt-3 text-xs font-medium text-rose-500">{error}</p>}
      </div>

      {/* Calendar */}
      <div className="mb-8 rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {CAL_VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => setCalView(v.key)}
              className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                calView === v.key
                  ? "bg-accent-500 text-white shadow-card"
                  : "border border-line bg-surface text-ink-2 hover:border-accent-300"
              }`}
            >
              {v.label}
            </button>
          ))}
          {meets.length > 0 && calView !== "boardings" && (
            <span className="ml-auto text-[11px] text-ink-3">
              {meets.length} meet &amp; greet{meets.length === 1 ? "" : "s"} booked
            </span>
          )}
        </div>
        <div className="mb-4 flex items-center justify-between">
          <button
            onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))}
            className="rounded-lg border border-line px-2.5 py-1 text-sm text-ink-3 hover:border-line"
          >
            ←
          </button>
          <p className="text-sm font-medium text-ink-2">{monthLabel}</p>
          <button
            onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))}
            className="rounded-lg border border-line px-2.5 py-1 text-sm text-ink-3 hover:border-line"
          >
            →
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase tracking-wide text-ink-3">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((d) => {
            const key = dateKey(d);
            const inMonth = d.getMonth() === calMonth.getMonth();
            const dayBoardings = boardingsOn(key);
            const dayMeets = meetsOn(key);
            return (
              <button
                key={key}
                onClick={() => setSelectedDay(key === selectedDay ? null : key)}
                className={`min-h-[64px] rounded-lg border p-1 text-left align-top text-[11px] transition ${
                  key === today ? "border-accent-400" : "border-line-soft"
                } ${key === selectedDay ? "ring-2 ring-accent-300" : ""} ${
                  inMonth ? "bg-surface" : "bg-surface-2 text-ink-3"
                }`}
              >
                <span className={`font-medium ${key === today ? "text-accent-600" : ""}`}>{d.getDate()}</span>
                <div className="mt-0.5 space-y-0.5">
                  {/* Meet & greets first — they are appointments at a set
                      time, where a boarding pill just means "staying". */}
                  {dayMeets.slice(0, 2).map((m) => (
                    <div
                      key={m.id}
                      className="truncate rounded border border-violet-200 bg-violet-50 px-1 py-0.5 text-violet-800"
                      title={`Meet & greet · ${m.dog_name} (${m.last_name})${
                        m.meet_greet_window ? ` · ${m.meet_greet_window}` : ""
                      }`}
                    >
                      ✨ {m.dog_name}
                    </div>
                  ))}
                  {dayMeets.length > 2 && (
                    <div className="text-violet-700">+{dayMeets.length - 2} more</div>
                  )}
                  {dayBoardings.slice(0, 3).map((b) => (
                    <div
                      key={b.id}
                      className={`truncate rounded border px-1 py-0.5 ${b.id ? colorFor.get(b.id) : ""}`}
                      title={`${b.dog_name} · ${b.start_date} → ${b.end_date}`}
                    >
                      {b.dog_name}
                    </div>
                  ))}
                  {dayBoardings.length > 3 && (
                    <div className="text-ink-3">+{dayBoardings.length - 3} more</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {selectedDay && (
          <div className="mt-4 rounded-xl border border-line-soft bg-surface-2 px-4 py-3">
            <p className="mb-2 text-xs font-medium text-ink-2">{prettyDateKey(selectedDay)}</p>
            {selectedDayBoardings.length === 0 && selectedDayMeets.length === 0 ? (
              <p className="text-xs text-ink-3">Nothing booked that day.</p>
            ) : (
              <ul className="space-y-1 text-xs text-ink-2">
                {selectedDayMeets.map((m) => (
                  <li key={m.id}>
                    ✨{" "}
                    <Link href={dogHref(m.id)} className="text-accent-600 hover:underline">
                      {m.dog_name}
                    </Link>{" "}
                    ({m.last_name}) · {m.phone} · meet &amp; greet
                    {m.meet_greet_window ? ` · ${m.meet_greet_window}` : ""}
                  </li>
                ))}
                {selectedDayBoardings.map((b) => (
                  <li key={b.id}>
                    🐕 {b.dog_name} ({b.last_name}) · {b.phone} · {b.start_date} → {b.end_date}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* List */}
      {loading ? (
        <p className="text-sm text-ink-3">Loading…</p>
      ) : (
        <>
          <p className="mb-3 text-sm font-medium text-ink-2">Upcoming &amp; current reservations</p>
          <div className="mb-8 space-y-2">
            {upcoming.map((b) => (
              <BoardingRow
                key={b.id}
                b={b}
                color={b.id ? colorFor.get(b.id) : undefined}
                onEdit={() => startEdit(b)}
                onDelete={() => deleteBoarding(b)}
                deleting={deletingId === b.id}
              />
            ))}
            {upcoming.length === 0 && <p className="text-sm text-ink-3">No upcoming reservations.</p>}
          </div>

          {past.length > 0 && (
            <details>
              <summary className="mb-3 cursor-pointer text-sm font-medium text-ink-3">
                Past reservations ({past.length})
              </summary>
              <div className="space-y-2">
                {past.map((b) => (
                  <BoardingRow
                    key={b.id}
                    b={b}
                    color={b.id ? colorFor.get(b.id) : undefined}
                    onEdit={() => startEdit(b)}
                    onDelete={() => deleteBoarding(b)}
                    deleting={deletingId === b.id}
                  />
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function BoardingRow({
  b,
  color,
  onEdit,
  onDelete,
  deleting,
}: {
  b: Boarding;
  color?: string;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const total = estimateBoardingTotal(b.start_date, b.end_date, {
    addons: b.addons ?? [],
    walksPerDay: b.walks_per_day,
    bathSize: b.bath_size ?? null,
  }).amount;
  const addonLabels = (b.addons ?? [])
    .map((a) => BOARDING_ADDONS.find((x) => x.key === a)?.label)
    .filter(Boolean)
    .join(", ");

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-5 py-3.5 shadow-card">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${color?.split(" ")[0] ?? "bg-surface-3"}`} />
          {b.dog_name}
          <span className="font-normal text-ink-3">· {b.last_name}</span>
          <span className="text-xs font-medium text-emerald-700">${total.toFixed(2)}</span>
        </p>
        <p className="text-xs text-ink-3">
          {b.phone} · {b.start_date} → {b.end_date}
        </p>
        {addonLabels && <p className="mt-0.5 truncate text-xs text-ink-3">➕ {addonLabels}</p>}
        {b.feeding_instructions && (
          <p className="mt-0.5 truncate text-xs text-ink-3">🍽️ {b.feeding_instructions}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Link
          href={`/report?boardingId=${b.id}`}
          className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-line"
        >
          Info
        </Link>
        <button
          onClick={onEdit}
          className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-line"
        >
          Edit
        </button>
        <button
          onClick={onDelete}
          disabled={deleting}
          className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs text-rose-500 hover:border-rose-300 disabled:opacity-60"
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>
    </div>
  );
}
