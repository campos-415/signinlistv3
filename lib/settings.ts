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
  // One brand colour and one print colour. The shade ramps either side of
  // them are derived — see lib/theme.ts — so staff pick two colours, not
  // twelve.
  accentColor: string; // "#rrggbb"
  printColor: string;
}

// A package the business sells: so many daycare days for a set price.
// Selling one picks a tier rather than typing an amount, so the price list
// stays consistent and the discount is deliberate.
export interface PackageTier {
  kind?: "daycare" | "walk"; // absent means daycare, for tiers saved before walks existed
  days: number;
  price: number;
}

// Client-facing email. The provider key is a server-side env var
// (RESEND_API_KEY) — only the wording and the addresses are settings, so a
// business can reword everything without a deploy.
//
// Templates support {{owner}}, {{dogs}}, {{business}} and {{phone}}.
export interface EmailSettings {
  // The acknowledgement sent the moment a form is submitted. Off by
  // default, because an install with no verified sending domain would just
  // be generating failures.
  autoAcknowledge: boolean;
  fromName: string;
  fromAddress: string;
  replyTo: string;
  ackSubject: string;
  ackBody: string;
  // Starting points for the messages staff send after reviewing. They're
  // editable in the compose box before sending — that's the "custom" half.
  approvedSubject: string;
  approvedBody: string;
  declinedSubject: string;
  declinedBody: string;
  // Boarding requests. Separate wording from enrollment, because these also
  // carry dates — {{dropoff}}, {{pickup}} and {{nights}} work here too.
  boardingAckSubject: string;
  boardingAckBody: string;
  boardingConfirmedSubject: string;
  boardingConfirmedBody: string;
  boardingDeclinedSubject: string;
  boardingDeclinedBody: string;
  // Where to tell STAFF that something new came in. Separate from
  // everything above, which is client-facing. Comma-separated for a shared
  // inbox plus a manager, say.
  notifyAddresses: string;
  notifyOnNewRequest: boolean;
}

export interface AppSettings {
  business: BusinessSettings;
  pricing: PricingSettings;
  addons: CatalogItem[];
  boardingAddons: CatalogItem[];
  services: CatalogItem[];
  packageTiers: PackageTier[];
  email: EmailSettings;
}

// The values the app shipped with. Used until settings load, and as the
// baseline a fresh install starts from.
export const DEFAULT_SETTINGS: AppSettings = {
  business: {
    name: "Lombard Doggy Daycare",
    tagline: "Sign your pup in or out",
    logoData: null,
    accentColor: "#4a72ef",
    printColor: "#f59e0b",
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
    { kind: "daycare", days: 5, price: 325 },
    { kind: "daycare", days: 10, price: 600 },
    { kind: "daycare", days: 20, price: 1100 },
    { kind: "walk", days: 10, price: 250 },
  ],
  email: {
    autoAcknowledge: false,
    fromName: "",
    fromAddress: "",
    replyTo: "",
    ackSubject: "We've received your enrollment — {{business}}",
    ackBody: `Hi {{owner}},

Thanks for enrolling {{dogs}} with {{business}}.

We've got your form and someone will review it shortly. Once it's approved we'll email you to arrange the meet & greet, and from then on you can check in at the front desk with just your phone number.

If anything changes in the meantime, just reply to this email.

— {{business}}`,
    approvedSubject: "You're all set at {{business}}",
    approvedBody: `Hi {{owner}},

Good news — {{dogs}} is approved and on our books.

Next step is the meet & greet. Give us a call or reply here and we'll find a time that works.

After that, checking in is just your phone number ({{phone}}) at the front desk.

See you soon,
{{business}}`,
    declinedSubject: "About your enrollment at {{business}}",
    declinedBody: `Hi {{owner}},

Thanks for your interest in {{business}}, and for taking the time to fill in the enrollment form for {{dogs}}.

Unfortunately we aren't able to take {{dogs}} on at the moment.

Please do get in touch if you'd like to talk it through.

— {{business}}`,
    boardingAckSubject: "We've got your boarding request — {{business}}",
    boardingAckBody: `Hi {{owner}},

Thanks for asking about boarding for {{dogs}}, {{dropoff}} to {{pickup}} ({{nights}} nights).

This is a request, not a confirmed booking yet — we'll check availability and email you back to confirm. Please don't drop off until you've heard from us.

— {{business}}`,
    boardingConfirmedSubject: "Boarding confirmed — {{dropoff}} to {{pickup}}",
    boardingConfirmedBody: `Hi {{owner}},

You're booked. We'll see {{dogs}} on {{dropoff}}, going home {{pickup}} — {{nights}} nights.

Please bring their food, any medication in its original packaging, and make sure vaccinations are current.

If anything changes, call us as soon as you can.

See you then,
{{business}}`,
    boardingDeclinedSubject: "About your boarding request — {{business}}",
    boardingDeclinedBody: `Hi {{owner}},

Thanks for asking about boarding for {{dogs}} from {{dropoff}} to {{pickup}}.

Unfortunately we can't take that booking. We're sorry to miss them.

Do get in touch if you'd like to look at other dates.

— {{business}}`,
    notifyAddresses: "",
    notifyOnNewRequest: true,
  },
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
    email: { ...DEFAULT_SETTINGS.email, ...(stored.email ?? {}) },
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
