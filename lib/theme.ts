// Turns the two colours a business picks in /settings into the full set of
// CSS variables the app paints with.
//
// Staff choose one brand colour and one print colour, not a twelve-step
// ramp — asking a front desk to pick `accent-400` would be absurd, and a
// hand-picked ramp is where off-brand tints creep in. The shades are derived
// by mixing toward white and black.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const h = (v: number) => Math.round(clamp(v)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, v));
}

/** Mix toward white (amount > 0) or black (amount < 0), -1..1. */
function shade(c: Rgb, amount: number): Rgb {
  const target = amount > 0 ? 255 : 0;
  const t = Math.abs(amount);
  return {
    r: c.r + (target - c.r) * t,
    g: c.g + (target - c.g) * t,
    b: c.b + (target - c.b) * t,
  };
}

const triple = (c: Rgb) => `${Math.round(clamp(c.r))} ${Math.round(clamp(c.g))} ${Math.round(clamp(c.b))}`;

// How far each step sits from the chosen base. Tuned so 500 is exactly the
// picked colour and the tints stay light enough to read dark text on.
const ACCENT_STEPS: [string, number][] = [
  ["--accent-50", 0.94],
  ["--accent-100", 0.86],
  ["--accent-400", 0.34],
  ["--accent-500", 0],
  ["--accent-600", -0.16],
  ["--accent-700", -0.34],
];

const PRINT_STEPS: [string, number][] = [
  ["--print-from", 0],
  ["--print-to", -0.16], // the header gradient's darker end
  ["--print-rule", 0.55], // heavier table rules
  ["--print-line", 0.72], // hairline cell borders
  ["--print-band", 0.82], // group-header band
  ["--print-tint", 0.93], // zebra striping — must stay near-white in print
  ["--print-ink", -0.45], // footer text, dark enough to read
];

export interface ThemeVars {
  [k: string]: string;
}

export function themeVars(accentHex: string, printHex: string): ThemeVars {
  const vars: ThemeVars = {};
  const accent = hexToRgb(accentHex);
  const print = hexToRgb(printHex);
  if (accent) for (const [name, amt] of ACCENT_STEPS) vars[name] = triple(shade(accent, amt));
  if (print) for (const [name, amt] of PRINT_STEPS) vars[name] = triple(shade(print, amt));
  return vars;
}

// Applied to <html> so both Tailwind's colour utilities and the inline
// @media print blocks resolve against the same values.
export function applyTheme(accentHex: string, printHex: string): void {
  if (typeof document === "undefined") return;
  const vars = themeVars(accentHex, printHex);
  for (const [name, value] of Object.entries(vars)) {
    document.documentElement.style.setProperty(name, value);
  }
}
