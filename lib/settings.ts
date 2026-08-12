// Runtime app settings — prices, the add-on and service catalogs, and the
// business's own branding. These used to be hardcoded constants; they now
// live in a single `settings` row so staff can change them from /settings
// without a redeploy.
//
// The values are cached in a module singleton and read through getter
// objects (see lib/pricing.ts), which keeps every pricing function pure and
// synchronous — nothing had to become async to support this.

import { getSupabase } from "@/lib/supabase";
import { DEFAULT_CONTENT, SiteContent } from "@/lib/siteContent";

export interface PricingSettings {
  daycareFullDay: number;
  daycareHalfDay: number;
  daycareHalfDayThresholdHours: number;
  boardingPerNight: number;
  // Discounted nightly rate for a second dog from the same household.
  boardingSecondDogPerNight: number;
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
  // ---- Contact details -------------------------------------------------
  // Shown across the public website: header, footer, contact page, and the
  // LocalBusiness structured data search engines read. Editable here so a
  // change of hours or a new phone number does not need a deploy.
  //
  // Consistent name/address/phone across a site is a real local-SEO signal,
  // which is the other reason these live in exactly one place.
  phone: string;
  email: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  hoursWeekday: string;
  hoursWeekend: string;
  hoursBoarding: string;
  instagram: string; // full URL
  instagramHandle: string;
  domain: string; // canonical https:// origin, for metadata and sitemaps
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
  // The second half of the enrollment, sent when a meet & greet is recorded
  // as passed. {{link}} is the household's own details form — without it the
  // message has nothing to act on, so the settings page says so.
  detailsRequestSubject: string;
  detailsRequestBody: string;
  // The invitation to claim a client account. {{link}} carries a one-time
  // token, and it is the only way an account is ever attached to a
  // household — so a message without it invites somebody to nothing. The
  // settings page says so, the same as it does for the details form.
  portalInviteSubject: string;
  portalInviteBody: string;
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

// Whether this deployment serves the built-in marketing website.
//
// Two ways a business uses this app:
//   - As their whole web presence: the website is on, and / is the home page.
//   - Back office only: they already have a site they like, and just want
//     the kiosk, the staff pages, and the forms to embed. The website is off,
//     / goes straight to the kiosk, and the marketing pages are not served.
//
// Either way /enroll and /book stay available, because those are the pieces
// an existing website needs to link to or iframe.
/** One customer review shown on the marketing site. */
export interface ReviewItem {
  name: string;
  /** Free text, e.g. "October 2025" — reviews rarely need a real date. */
  date: string;
  /** 1-5. */
  rating: number;
  quote: string;
}

export interface ReviewsSettings {
  enabled: boolean;
  /** Where they came from, shown as "from Yelp" under the average. */
  source: string;
  items: ReviewItem[];
}

export interface SiteSettings {
  enabled: boolean;
  // Where "home" points when the built-in site is off — normally their own
  // website. Blank sends people to the kiosk instead.
  externalUrl: string;
}

// Card payments through the Square Point of Sale app. Neither value is a
// secret — the application ID travels in the deep link the browser opens,
// so both live in settings rather than in an env var, and each business
// configures its own.
export interface SquareSettings {
  enabled: boolean;
  applicationId: string;
  locationId: string;
  // Runs the whole flow except Square: the button jumps straight to the
  // return page with a pretend success. Square's Point of Sale API has no
  // sandbox for the deep link, and the real thing needs the app, a real
  // account and a deployed https domain — so without this there is no way
  // to see the flow work before going live.
  //
  // Payments recorded this way are marked TEST and can be cleared from
  // Settings. Nothing is ever charged.
  testMode: boolean;
}

// Who can be recorded as having done a walk. Kept as a list rather than a
// free-text box so the walk log stays consistent — "RM", "R. Marsh" and
// "Rob" for one person makes the log useless for answering who walked a dog.
export interface StaffSettings {
  /** Display names, shown in the walk log dropdown. */
  names: string[];
  /** Earliest and latest selectable walk time, and the step, in minutes. */
  walkDayStartHour: number;
  walkDayEndHour: number;
  walkStepMinutes: number;
}

export interface AppSettings {
  site: SiteSettings;
  // Every word the marketing pages say. See lib/siteContent.ts.
  content: SiteContent;
  reviews: ReviewsSettings;
  business: BusinessSettings;
  pricing: PricingSettings;
  addons: CatalogItem[];
  boardingAddons: CatalogItem[];
  services: CatalogItem[];
  packageTiers: PackageTier[];
  email: EmailSettings;
  square: SquareSettings;
  staff: StaffSettings;
}

// The values the app shipped with. Used until settings load, and as the
// baseline a fresh install starts from.
export const DEFAULT_SETTINGS: AppSettings = {
  site: { enabled: true, externalUrl: "" },
  content: DEFAULT_CONTENT,
  reviews: {
    enabled: true,
    source: "Yelp",
    items: [
      {
        name: "Rowena W.",
        date: "October 2025",
        rating: 5,
        quote:
          "One of the cleanest doggy daycares — spacious, light and airy, with dependable, attentive staff.",
      },
      {
        name: "Carmen E.",
        date: "August 2024",
        rating: 5,
        quote:
          "Never experienced a doggie daycare as pristine clean as this! The place is immaculate.",
      },
      {
        name: "Catrina L.",
        date: "June 2024",
        rating: 5,
        quote:
          "My dog loves going so much that all I have to do is say daycare in the morning and he runs to the front door.",
      },
      { name: "Sara B.", date: "June 2024", rating: 5, quote: "The facility is clean and bright." },
    ],
  },
  business: {
    name: "Lombard Doggy Daycare",
    tagline: "Sign your pup in or out",
    logoData: null,
    accentColor: "#4a72ef",
    printColor: "#f59e0b",
    phone: "(415) 535-8520",
    email: "support@lombarddoggydaycare.com",
    street: "1488 Lombard Street",
    city: "San Francisco",
    state: "CA",
    zip: "94123",
    hoursWeekday: "Monday – Friday, 7:00 AM – 7:00 PM",
    hoursWeekend: "Saturday - Sunday 9:00 AM - 5:00 PM",
    hoursBoarding: "Overnight care, 7 days a week",
    instagram: "https://www.instagram.com/lombard_doggy_daycare",
    instagramHandle: "@lombard_doggy_daycare",
    domain: "https://www.lombarddoggydaycare.com",
  },
  pricing: {
    daycareFullDay: 70,
    daycareHalfDay: 50,
    daycareHalfDayThresholdHours: 4,
    boardingPerNight: 90,
    boardingSecondDogPerNight: 80,
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
  square: { enabled: false, applicationId: "", locationId: "", testMode: false },
  staff: { names: [], walkDayStartHour: 6, walkDayEndHour: 21, walkStepMinutes: 30 },
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
    detailsRequestSubject: "{{dogs}} passed — a few last details for {{business}}",
    detailsRequestBody: `Hi {{owner}},

{{dogs}} did well at the meet & greet, and we would love to see them again.

There is one thing left: the rest of your profile. It takes a couple of minutes and covers the things we need before a full day — your address, your vet, an emergency contact, and how {{dogs}} is around other dogs.

{{link}}

The link is yours alone and does not expire, so finish it whenever suits. If you would rather do it at the front desk, just say so when you next come in.

— {{business}}`,
    portalInviteSubject: "Your {{business}} account is ready to set up",
    portalInviteBody: `Hi {{owner}},

You can now see everything we hold for {{dogs}} in one place — vaccination dates, package days left, past visits and what is outstanding — and ask us for boarding dates without ringing up.

Set your password here:

{{link}}

That link is yours alone and works once, so please do not forward it. It is good for {{days}} days; if it runs out, just ask us for another.

You will still hear from us to confirm any dates you request — nothing is booked automatically.

— {{business}}`,
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

/** The website's copy. Shorthand for the many callers that want only this. */
export function getContent(): SiteContent {
  return cache.content;
}

export function settingsLoaded(): boolean {
  return loaded;
}

// Recursive merge, driven by the shape of the default rather than by what is
// stored. Website copy is deeply nested and mostly optional, so spelling out
// every level by hand the way the sections below do would be unreadable and
// would silently drop a field the day someone adds one.
//
// Walking the DEFAULT's keys is the important part: a row written by an older
// version gains any field added since, and junk left in the JSON by a
// half-finished experiment is dropped rather than reaching a page.
//
// `undefined` means absent, so the default fills in. Anything else stored
// wins — including an empty string and an empty array, which are how staff
// say "I want nothing here". Treating those as absent is what makes a
// deleted paragraph reappear on the next reload.
function deepMerge<T>(base: T, over: unknown): T {
  if (over === undefined || over === null) return base;
  if (Array.isArray(base)) return (Array.isArray(over) ? over : base) as T;
  if (typeof base === "object" && base !== null && typeof over === "object") {
    const src = over as Record<string, unknown>;
    const out = { ...(base as Record<string, unknown>) };
    for (const key of Object.keys(out)) out[key] = deepMerge(out[key], src[key]);
    return out as T;
  }
  // A stored value of the wrong type (a number where a headline belongs)
  // would render as garbage; fall back rather than trust it.
  return typeof over === typeof base ? (over as T) : base;
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
    // `?? ` not `?.length ?` — deleting every tier is a legitimate choice
    // (a business that sells no packages), and treating the empty array as
    // "unset" silently resurrected the defaults.
    //
    // The catalogs above keep the length check on purpose: code depends on
    // the built-in keys existing, so an empty list there is a broken state
    // rather than a deliberate one.
    packageTiers: stored.packageTiers ?? DEFAULT_SETTINGS.packageTiers,
    email: { ...DEFAULT_SETTINGS.email, ...(stored.email ?? {}) },
    square: { ...DEFAULT_SETTINGS.square, ...(stored.square ?? {}) },
    staff: { ...DEFAULT_SETTINGS.staff, ...(stored.staff ?? {}) },
    site: { ...DEFAULT_SETTINGS.site, ...(stored.site ?? {}) },
    content: deepMerge(DEFAULT_CONTENT, stored.content),
    reviews: {
      ...DEFAULT_SETTINGS.reviews,
      ...(stored.reviews ?? {}),
      // A business with no reviews yet is a legitimate state, so an empty
      // list must not resurrect the shipped ones.
      items: stored.reviews?.items ?? DEFAULT_SETTINGS.reviews.items,
    },
  };
}

// When the row we loaded was last written. Used to notice that somebody
// else saved in the meantime — the whole settings object is stored as one
// JSON blob, so a blind write silently discards their edit rather than
// merging with it.
let loadedStamp: string | null = null;

export class SettingsConflictError extends Error {
  constructor() {
    super("Settings were changed elsewhere since this page was opened.");
    this.name = "SettingsConflictError";
  }
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from("settings").select("*").eq("id", 1).maybeSingle();
    if (error) throw error;
    const row = data as { data?: Partial<AppSettings>; updated_at?: string } | null;
    loadedStamp = row?.updated_at ?? null;
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

  // Optimistic concurrency. Two people with /settings open — or one person
  // with two tabs — would otherwise overwrite each other completely, and
  // the loser would never know: deleted package tiers reappear, a reworded
  // email template reverts. Refuse rather than clobber.
  const { data: current, error: readErr } = await supabase
    .from("settings")
    .select("updated_at")
    .eq("id", 1)
    .maybeSingle();
  if (readErr) throw readErr;
  const stamp = (current as { updated_at?: string } | null)?.updated_at ?? null;
  if (loadedStamp !== null && stamp !== null && stamp !== loadedStamp) {
    throw new SettingsConflictError();
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("settings")
    .upsert({ id: 1, data: next, updated_at: now }, { onConflict: "id" });
  if (error) throw error;
  loadedStamp = now;
  cache = next;
}
