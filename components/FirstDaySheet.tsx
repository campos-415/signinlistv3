"use client";

import { ageFromBirthdate } from "@/lib/enrollment";
import { prettyDateKey, todayKey } from "@/lib/dates";
import { Dog, Owner } from "@/types";

// The sheet a household takes home after a meet & greet.
//
// Split out from the page so it can be rendered on its own — the page sits
// behind a staff sign-in, and a print layout that can only be looked at by
// somebody who is signed in is a print layout nobody checks.

export interface FirstDayReport {
  settled: string;
  play: string;
  energy: string;
  favourite: string;
  working: string;
  recommend: string;
  staff: string;
}

export const EMPTY_REPORT: FirstDayReport = {
  settled: "",
  play: "",
  energy: "",
  favourite: "",
  working: "",
  recommend: "",
  staff: "",
};

// Offered as taps rather than free text, because this gets filled in at a
// desk with somebody waiting.
const SETTLED = ["Straight in", "Took a few minutes", "Needed some time", "Found it hard"];
const PLAY = ["Played with everyone", "Picked a friend", "Watched first", "Preferred people", "Kept to themselves"];
const ENERGY = ["Calm", "Steady", "Busy", "Full tilt"];
const RECOMMEND = ["Ready for full days", "Start with half days", "Two days a week to settle", "Small group only", "Let us talk it through"];

export default function FirstDaySheet({
  dog,
  owner,
  report,
  onChange,
  businessName,
  businessPhone,
}: {
  dog: Dog;
  owner?: Owner | null;
  report: FirstDayReport;
  onChange: (next: FirstDayReport) => void;
  businessName: string;
  businessPhone?: string;
}) {
  const age = ageFromBirthdate(dog.birthdate);
  const set = <K extends keyof FirstDayReport>(key: K, value: string) =>
    onChange({ ...report, [key]: value });

  return (
    <article className="rounded-2xl border border-line bg-surface p-6 shadow-card print:rounded-none print:border-0 print:bg-white print:p-0 print:shadow-none">
      {/* The same print block every other report on this app carries.
          print-color-adjust: exact is the important line — without it the
          browser drops background colours when printing, which is why this
          sheet came out plain while the day and stay reports came out
          branded. It travels inside the component so it reaches the print
          document along with the sheet. */}
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

      {/* The banner the other reports lead with. Print only: on screen the
          page already has a heading, and the household is looking at their
          own dog rather than at a document. */}
      <div className="print-header mb-5 hidden px-6 py-5 print:block">
        <h2 className="font-display text-2xl font-bold text-white">🐾 {businessName}</h2>
        <p className="text-base font-medium text-white/90">
          My first day — {dog.dog_name}
        </p>
      </div>

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
          {/* On screen this names the business; in print the banner above
              already has, so it would be the second time in two inches. */}
          <p className="text-[11px] font-semibold uppercase tracking-wide text-accent-600 print:hidden">
            My first day at {businessName}
          </p>
          <h2 className="font-display text-2xl font-semibold text-ink">{dog.dog_name}</h2>
          <p className="mt-0.5 text-sm text-ink-3 print:text-ink-2">
            {[dog.breed, age, dog.sex === "female" ? "girl" : dog.sex === "male" ? "boy" : ""]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="mt-1 text-xs text-ink-3 print:text-ink-2">
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

      <div className="mt-5 flex items-end justify-between gap-4 border-t border-line-soft pt-3 print:break-inside-avoid print:border-paper-rule">
        <div className="flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-3 print:text-ink-2">
            Looked after by
          </p>
          {/* An input prints as an input: a box with a border the browser
              draws its own way. On a sheet somebody is handed it should be a
              name on a line. */}
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
        <p className="text-right text-[11px] text-ink-3 print:text-ink-2">
          {businessName}
          {businessPhone ? ` · ${businessPhone}` : ""}
        </p>
      </div>
    </article>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // break-inside-avoid so a question and its answer are never split across
    // two sheets, which is the one way a one-page handout becomes two.
    <section className="mt-4 print:break-inside-avoid">
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
 * one dog, not a form with boxes ticked.
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
