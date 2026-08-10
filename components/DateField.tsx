"use client";

import { useEffect, useRef, useState } from "react";

// A date field that can be typed, pasted, or picked.
//
// A bare <input type="date"> can't be pasted into — browsers don't deliver
// clipboard text to the segmented editor — and its internals can't be styled,
// so it fights dark mode. This renders a normal text input (pasteable and
// fully themeable) with a calendar button that opens the real native picker
// via showPicker() on a hidden date input.
//
// Values are always emitted as "YYYY-MM-DD" — what every caller and Postgres
// expects — regardless of what format was pasted in.

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const US = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;
const YMD_SLASH = /^(\d{4})[/](\d{1,2})[/](\d{1,2})$/;

function pad(n: number | string) {
  return String(n).padStart(2, "0");
}

/** Parses the formats people actually paste. Returns "" when unrecognisable. */
export function parseDateInput(raw: string): string {
  const t = raw.trim();
  if (!t) return "";

  let m = ISO.exec(t);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;

  m = YMD_SLASH.exec(t);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;

  // Ambiguous by nature; US order is the assumption for a US daycare.
  m = US.exec(t);
  if (m) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;

  // Last resort for things like "Aug 9, 2026". Parsed as local noon so a
  // timezone offset can't roll it onto the previous day.
  const d = new Date(`${t} 12:00`);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return "";
}

export default function DateField({
  value,
  onChange,
  className = "",
  wrapperClassName = "w-full",
  placeholder = "YYYY-MM-DD",
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  // Sizing belongs on the wrapper, because the calendar button is positioned
  // against it. A narrow input inside a full-width wrapper leaves the button
  // stranded at the far right, nowhere near the field.
  wrapperClassName?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  // Held as text while editing so a half-typed date isn't thrown away, then
  // normalised on blur.
  const [text, setText] = useState(value ?? "");
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(value ?? "");
  }, [value]);

  function commit(raw: string) {
    const iso = parseDateInput(raw);
    if (iso) {
      setText(iso);
      onChange(iso);
    } else if (!raw.trim()) {
      setText("");
      onChange("");
    } else {
      setText(value ?? ""); // unparseable — put the old value back
    }
  }

  return (
    <span className={`relative inline-flex items-center ${wrapperClassName}`}>
      <input
        type="text"
        inputMode="numeric"
        value={text}
        aria-label={ariaLabel}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
        }}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData("text");
          const iso = parseDateInput(pasted);
          if (iso) {
            e.preventDefault();
            setText(iso);
            onChange(iso);
          }
        }}
        className={`${className} w-full pr-9`}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Open calendar"
        onClick={() => {
          const el = picker.current;
          if (!el) return;
          // showPicker throws if the browser blocks it; falling back to focus
          // still gets the user to a usable control.
          try {
            el.showPicker();
          } catch {
            el.focus();
          }
        }}
        className="absolute right-2 text-xs opacity-60 transition hover:opacity-100 print:hidden"
      >
        📅
      </button>
      {/* The real picker, kept out of the layout — it only exists to be opened. */}
      <input
        ref={picker}
        type="date"
        value={/^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ""}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value);
        }}
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute right-2 h-0 w-0 opacity-0"
      />
    </span>
  );
}
