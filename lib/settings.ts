// Runtime app settings — prices, the add-on and service catalogs, and the
// business's own branding. These used to be hardcoded constants; they now
// live in a single `settings` row so staff can change them from /settings
// without a redeploy.
//
// The values are cached in a module singleton and read through getter
// objects (see lib/pricing.ts), which keeps every pricing function pure and
// synchronous — nothing had to become async to support this.

import { getSupabase } from "@/lib/supabase";

export interface PricingSettings {
  daycareFullDay: number;
  daycareHalfDay: number;
  daycareHalfDayThresholdHours: number;
  boardingPerNight: number;
  latePickupHour: number;
  latePickupFee: number;
  bath: { S: number; M: number; L: number };
  // Walk-in add-on prices, keyed by add-on. Custom add-ons added on
  // /settings land here too.
  addons: Record<string, number>;
  boardingWalkPerWalk: number;
  boardingMedicationPerDay: number;
  boardingNailTrim: number;
}

export interface CatalogItem {
  key: string;
  label: string;
  icon: string;
  // Built-ins can be renamed and repriced but not deleted — code special-
  // cases them (bath has sizes, walk feeds the walk log, boarding needs its
  // medication entry), so removing one would break those paths.
  builtin?: boolean;
}

export interface BusinessSettings {
  name: string;
  tagline: string;
  logoData: string | null; // base64 data URL; falls back to the bundled logo
}

// A package the business sells: so many daycare days for a set price.
// Selling one picks a tier rather than typing an amount, so the price list
// stays consistent and the discount is deliberate.
export interface PackageTier {
  days: number;
  price: number;
}

export interface AppSettings {
  business: BusinessSettings;
  pricing: PricingSettings;
  addons: CatalogItem[];
  boardingAddons: CatalogItem[];
  services: CatalogItem[];
  packageTiers: PackageTier[];
}

// The values the app shipped with. Used until settings load, and as the
// baseline a fresh install starts from.
export const DEFAULT_SETTINGS: AppSettings = {
  business: {
    name: "Lombard Doggy Daycare",
    tagline: "Sign your pup in or out",
    logoData: null,
  },
  pricing: {
    daycareFullDay: 70,
    daycareHalfDay: 50,
    daycareHalfDayThresholdHours: 4,
    boardingPerNight: 90,
    latePickupHour: 12,
    latePickupFee: 50,
    bath: { S: 60, M: 80, L: 100 },
    addons: { walk: 30, nail_trim: 25 },
    boardingWalkPerWalk: 25,
    boardingMedicationPerDay: 10,
    boardingNailTrim: 25,
  },
  addons: [
    { key: "bath", label: "Bath", icon: "🛁", builtin: true },
    { key: "walk", label: "Walk", icon: "🚶", builtin: true },
    { key: "nail_trim", label: "Nail trim", icon: "💅", builtin: true },
  ],
  boardingAddons: [
    { key: "walk", label: "Walks", icon: "🚶", builtin: true },
    { key: "bath", label: "Bath", icon: "🛁", builtin: true },
    { key: "nail_trim", label: "Nail trim", icon: "💅", builtin: true },
    { key: "medication", label: "Medication", icon: "💊", builtin: true },
  ],
  services: [
    { key: "daycare", label: "Daycare", icon: "🐕", builtin: true },
    { key: "boarding", label: "Boarding", icon: "🛏️", builtin: true },
    { key: "meet_greet", label: "Meet & greet", icon: "✨", builtin: true },
  ],
  // Buying in bulk beats the $70 walk-in day, more so the bigger the block.
  packageTiers: [
    { days: 5, price: 325 },
    { days: 10, price: 600 },
    { days: 20, price: 1100 },
  ],
};

let cache: AppSettings = DEFAULT_SETTINGS;
let loaded = false;

export function getSettings(): AppSettings {
  return cache;
}

export function settingsLoaded(): boolean {
  return loaded;
}

// Merges a stored row over the defaults, so a settings row written by an
// older version of the app doesn't blank out fields added since.
function merge(stored: Partial<AppSettings> | null): AppSettings {
  if (!stored) return DEFAULT_SETTINGS;
  return {
    business: { ...DEFAULT_SETTINGS.business, ...(stored.business ?? {}) },
    pricing: {
      ...DEFAULT_SETTINGS.pricing,
      ...(stored.pricing ?? {}),
      bath: { ...DEFAULT_SETTINGS.pricing.bath, ...(stored.pricing?.bath ?? {}) },
      addons: { ...DEFAULT_SETTINGS.pricing.addons, ...(stored.pricing?.addons ?? {}) },
    },
    addons: stored.addons?.length ? stored.addons : DEFAULT_SETTINGS.addons,
    boardingAddons: stored.boardingAddons?.length
      ? stored.boardingAddons
      : DEFAULT_SETTINGS.boardingAddons,
    services: stored.services?.length ? stored.services : DEFAULT_SETTINGS.services,
    packageTiers: stored.packageTiers?.length
      ? stored.packageTiers
      : DEFAULT_SETTINGS.packageTiers,
  };
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from("settings").select("*").eq("id", 1).maybeSingle();
    if (error) throw error;
    const row = data as { data?: Partial<AppSettings> } | null;
    cache = merge(row?.data ?? null);
  } catch (e) {
    // A missing table or a network blip shouldn't take the kiosk down — the
    // shipped defaults are a perfectly usable price list.
    console.error("Loading settings failed, using defaults:", e);
    cache = DEFAULT_SETTINGS;
  }
  loaded = true;
  return cache;
}

export async function saveSettings(next: AppSettings): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("settings")
    .upsert({ id: 1, data: next, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw error;
  cache = next;
}
