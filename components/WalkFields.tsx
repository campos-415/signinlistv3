"use client";

import { useSettings } from "@/components/SettingsProvider";

// The two controls a walk log row needs, shared by the daycare log on
// /in-house and the boarding log on /stay-report so both behave the same.
//
// Both were free-text before. Times arrived as "2:15pm", "~2pm", "14:15"
// and staff as "RM", "R. Marsh", "Rob" — fine to jot down, useless for
// answering "who walked this dog and when".

/** "9:30am" for 9h30. The stored format stays what it always was. */
export function formatTime(hour: number, minute: number): string {
  const suffix = hour < 12 ? "am" : "pm";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, "0")}${suffix}`;
}

export function walkTimeOptions(startHour: number, endHour: number, step: number): string[] {
  const out: string[] = [];
  const safeStep = step > 0 ? step : 30;
  for (let m = startHour * 60; m <= endHour * 60; m += safeStep) {
    out.push(formatTime(Math.floor(m / 60), m % 60));
  }
  return out;
}

const selectClass =
  "rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent-500 print:border-0 print:bg-transparent print:px-0";

export function TimeSelect({
  value,
  onSave,
  ariaLabel,
  width = "w-24",
}: {
  value: string;
  onSave: (v: string) => void;
  ariaLabel: string;
  width?: string;
}) {
  const { settings } = useSettings();
  const { walkDayStartHour, walkDayEndHour, walkStepMinutes } = settings.staff;
  const options = walkTimeOptions(walkDayStartHour, walkDayEndHour, walkStepMinutes);
  // Anything already logged that isn't on the grid — "9:40am" from before
  // this was a dropdown — stays selectable, so editing another field on the
  // row cannot silently rewrite the time.
  const extra = value && !options.includes(value) ? value : null;

  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onSave(e.target.value)}
      className={`${selectClass} ${width}`}
    >
      <option value="">—</option>
      {extra && <option value={extra}>{extra}</option>}
      {options.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}

export function StaffSelect({
  value,
  onSave,
  ariaLabel,
  width = "w-24",
}: {
  value: string;
  onSave: (v: string) => void;
  ariaLabel: string;
  width?: string;
}) {
  const { settings } = useSettings();
  const names = settings.staff.names ?? [];
  const extra = value && !names.includes(value) ? value : null;

  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onSave(e.target.value)}
      title={names.length ? undefined : "Add staff names under Settings → Brand"}
      className={`${selectClass} ${width}`}
    >
      <option value="">—</option>
      {extra && <option value={extra}>{extra}</option>}
      {names.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}
