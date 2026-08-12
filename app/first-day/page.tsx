"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import StaffGate from "@/components/StaffGate";
import StaffNav from "@/components/StaffNav";
import { useSettings } from "@/components/SettingsProvider";
import { getSupabase } from "@/lib/supabase";
import { ageFromBirthdate } from "@/lib/enrollment";
import { prettyDateKey, todayKey } from "@/lib/dates";
import { Dog, Owner } from "@/types";

// "My first day" — the thing a household takes home from a meet & greet.
//
// It is printed rather than emailed on purpose. The meet & greet ends with
// the owner standing at the desk, and a sheet with their dog's photo on it
// handed over at that moment is worth more than a message they read that
// evening. It is also the first thing the business gives them that is about
// their dog rather than about paperwork.
//
// The fields are filled in on screen and printed. They are deliberately NOT
// stored: there is no table for them, and inventing one to hold a document
// whose whole purpose is to be handed over would be storing it for us rather
// than for them. If it turns out staff want to look one up six months later,
// that is a real reason to persist it and a different change.
//
// Reached from the sign-in list once a meet & greet has a photo, which is
// what makes the photo on the sheet possible.
export default function FirstDayPage() {
  return (
    <StaffGate title="First day report">
      <Suspense fallback={null}>
        <FirstDay />
      </Suspense>
    </StaffGate>
  );
}

interface Report {
  settled: string;
  play: string;
  energy: string;
  favourite: string;
  working: string;
  recommend: string;
  staff: string;
}

const EMPTY: Report = {
  settled: "",
  play: "",
  energy: "",
  favourite: "",
  working: "",
  recommend: "",
  staff: "",
};

// Offered as taps rather than free text, because this gets filled in at a
// desk with somebody waiting. Every one of them can still be typed over.
const SETTLED = ["Straight in", "Took a few minutes", "Needed some time", "Found it hard"];
const PLAY = ["Played with everyone", "Picked a friend", "Watched first", "Preferred people", "Kept to themselves"];
const ENERGY = ["Calm", "Steady", "Busy", "Full tilt"];
const RECOMMEND = ["Ready for full days", "Start with half days", "Two days a week to settle", "Small group only", "Let us talk it through"];

function FirstDay() {
  const params = useSearchParams();
  const dogId = params.get("dog") ?? "";
  const { settings } = useSettings();

  const [dog, setDog] = useState<Dog | null>(null);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [report, setReport] = useState<Report>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!dogId) {
      setError("No dog on the link.");
      setLoading(false);
      return;
    }
    try {
      const supabase = getSupabase();
      const { data, error: err } = await supabase.from("dogs").select("*").eq("id", dogId).maybeSingle();
      if (err) throw err;
      const found = (data as Dog | null) ?? null;
      setDog(found);
      if (found?.phone) {
        const { data: o } = await supabase
          .from("owners")
          .select("*")
          .eq("phone", found.phone)
          .maybeSingle();
        setOwner((o as Owner | null) ?? null);
      }
    } catch (e) {
      console.error("Loading the first-day report failed:", e);
      setError("Could not load that dog.");
    } finally {
      setLoading(false);
    }
  }, [dogId]);

  useEffect(() => {
    load();
  }, [load]);

  function set<K extends keyof Report>(key: K, value: string) {
    setReport((r) => ({ ...r, [key]: value }));
  }

  if (loading) return <p className="px-5 py-10 text-sm text-ink-3">Loading…</p>;
  if (error || !dog) {
    return <p className="px-5 py-10 text-sm text-rose-600">{error || "No dog found."}</p>;
  }

  const age = ageFromBirthdate(dog.birthdate);

  return (
    <div>
      <div className="print:hidden">
        {/* The report is opened from the sign-in list and belongs to it, so
            that is the tab that stays lit. */}
        <StaffNav current="/in-house" />
      </div>

      <div className="mx-auto max-w-2xl px-5 py-6 print:max-w-none print:px-0 print:py-0">
        <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
          <h1 className="font-display text-xl font-semibold text-ink">
            First day report — {dog.dog_name}
          </h1>
          <button
            onClick={() => window.print()}
            className="ml-auto rounded-xl bg-accent-500 px-5 py-2 text-sm font-medium text-accent-ink shadow-card transition hover:bg-accent-600"
          >
            🖨 Print for the owner
          </button>
        </div>
        <p className="mb-4 text-xs text-ink-3 print:hidden">
          Fill this in and print it. It is not saved — it is the copy the household takes home.
        </p>

        {/* The sheet itself. Everything below prints. */}
        <article className="rounded-2xl border border-line bg-surface p-6 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none">
          <header className="flex items-start gap-4 border-b border-line-soft pb-4 print:break-inside-avoid print:border-paper-rule">
            {dog.photo_data ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={dog.photo_data}
                alt={dog.dog_name}
                className="h-28 w-28 shrink-0 rounded-2xl object-cover print:h-24 print:w-24"
              />
            ) : (
              <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-4xl">
                🐕
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-accent-600">
                My first day at {settings.business.name}
              </p>
              <h2 className="font-display text-2xl font-semibold text-ink">{dog.dog_name}</h2>
              <p className="mt-0.5 text-sm text-ink-3">
                {[dog.breed, age, dog.sex === "female" ? "girl" : dog.sex === "male" ? "boy" : ""]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="mt-1 text-xs text-ink-3">
                {prettyDateKey(todayKey())}
                {owner?.owner_name ? ` · ${owner.owner_name}` : ""}
              </p>
            </div>
          </header>

          <Row label="How they settled in">
            <Chips options={SETTLED} value={report.settled} onChange={(v) => set("settled", v)} />
          </Row>
          <Row label="With the other dogs">
            <Chips options={PLAY} value={report.play} onChange={(v) => set("play", v)} />
          </Row>
          <Row label="Energy">
            <Chips options={ENERGY} value={report.energy} onChange={(v) => set("energy", v)} />
          </Row>

          <Row label="What they loved">
            <Line
              value={report.favourite}
              onChange={(v) => set("favourite", v)}
              placeholder="The paddling pool, the big lad from next door, a tennis ball…"
            />
          </Row>
          <Row label="What we will work on">
            <Line
              value={report.working}
              onChange={(v) => set("working", v)}
              placeholder="Sharing toys, settling at nap time, coming when called…"
            />
          </Row>

          <Row label="What we suggest next">
            <Chips options={RECOMMEND} value={report.recommend} onChange={(v) => set("recommend", v)} />
          </Row>

          <div className="mt-5 flex items-end justify-between gap-4 border-t border-line-soft pt-3 print:border-paper-rule">
            <div className="flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">
                Looked after by
              </p>
              {/* An input prints as an input: a box with a caret-sized gap
                  and a border the browser draws its own way. On a sheet
                  somebody is handed, it should be a name on a line. */}
              <input
                value={report.staff}
                onChange={(e) => set("staff", e.target.value)}
                placeholder="Your name"
                className="mt-0.5 w-full max-w-[14rem] border-b border-line bg-transparent pb-0.5 text-sm text-ink outline-none focus:border-accent-500 print:hidden"
              />
              <p className="mt-0.5 hidden min-h-[1.4em] max-w-[14rem] border-b border-paper-line text-sm text-ink print:block">
                {report.staff}
              </p>
            </div>
            <p className="text-right text-[11px] text-ink-3">
              {settings.business.name}
              {settings.business.phone ? ` · ${settings.business.phone}` : ""}
            </p>
          </div>
        </article>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // break-inside-avoid so a question and its answer are never split across
    // two sheets, which is the one way a one-page handout turns into two.
    <section className="mt-4 print:break-inside-avoid">
      {/* The label is grey on screen because the answer is what matters
          there. On paper grey-on-white at 11px is where a photocopier gives
          up, so it prints darker. */}
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3 print:text-ink-2">
        {label}
      </p>
      {children}
    </section>
  );
}

/**
 * A row of choices that also prints.
 *
 * On screen they are buttons; on paper the unchosen ones would be noise, so
 * only the chosen one prints — a handout should read like a sentence about
 * one dog, not like a form with boxes ticked.
 */
function Chips({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-1.5 print:hidden">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(value === o ? "" : o)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              value === o
                ? "border-accent-500 bg-accent-500 text-accent-ink"
                : "border-line bg-surface text-ink-2 hover:border-accent-400"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
      <p className="hidden text-sm text-ink print:block">{value || "—"}</p>
    </>
  );
}

/** A written line. Prints as the text, with a rule under it when empty. */
function Line({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100 print:hidden"
      />
      <p className="hidden min-h-[1.4em] border-b border-paper-line text-sm text-ink print:block">
        {value}
      </p>
    </>
  );
}
