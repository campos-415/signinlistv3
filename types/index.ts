export type SignAction = "drop_off" | "pick_up";

export type DogSex = "male" | "female";

// "intact" is the app's word for what an import might call "Not Fixed".
export type FixedStatus = "spayed" | "neutered" | "intact" | "unknown";

export const DOG_SEXES: { key: DogSex; label: string }[] = [
  { key: "female", label: "Female" },
  { key: "male", label: "Male" },
];

export const FIXED_STATUSES: { key: FixedStatus; label: string }[] = [
  { key: "spayed", label: "Spayed" },
  { key: "neutered", label: "Neutered" },
  { key: "intact", label: "Not fixed" },
  { key: "unknown", label: "Unknown" },
];
export type ServiceType = "daycare" | "boarding" | "meet_greet";
export type AddonKey = "bath" | "walk" | "nail_trim";

// Each sign-in (drop off OR pick up) is its own row, tagged by `action`.
// The /records page merges a dog's drop-off and pick-up row for the same
// day into a single displayed line — see mergeRecords() in app/records/page.tsx.
export type BathSize = "S" | "M" | "L";

export interface SignInRecord {
  id?: string;
  dog_name: string;
  phone: string;
  drop_off_by: string;
  pick_up_by?: string;
  last_name: string;
  action: SignAction;
  service_type: ServiceType;
  addons: string[];
  bath_size?: BathSize | null; // set later on /records, not at drop-off — see lib/pricing.ts
  package_id?: string | null;
  client_id?: string | null;
  price?: number | null; // charge for this visit when no package covers it — set at pick-up, staff-editable after (e.g. to add bath charges)
  signature_data: string; // base64 PNG, may be empty if the client's waiver is on file from signup
  // Daycare walk log — filled in on /records for a drop-off with the
  // "walk" add-on, free-text rather than a strict time so staff can jot
  // down whatever's fastest ("2:15pm", "~2pm", etc).
  walk_out?: string | null;
  walk_in?: string | null;
  walk_staff_initials?: string | null;
  pickup_window?: string | null; // chosen at drop-off when a bath is booked — see PICKUP_WINDOWS
  by_staff?: boolean | null; // recorded by staff on the client's behalf, not at the lobby kiosk
  created_at?: string;
}

// Pick-up time windows offered at the kiosk when a bath is added, so
// grooming knows when the dog is expected back at the front.
export const PICKUP_WINDOWS: string[] = ["11am–1pm", "1–3pm", "3–5pm", "5–7pm"];

export interface Package {
  id?: string;
  client_name: string;
  dog_name?: string;
  phone: string;
  total_days: number;
  days_used: number;
  // What the client paid for the package. This is the revenue event — it's
  // counted on the day the package was sold, and the visits it later covers
  // are $0, since the money already changed hands here.
  price?: number | null;
  created_at?: string;
}

// A one-time signup profile. Waiver is signed once here; daily kiosk
// check-in just looks this up by phone instead of re-collecting it.
export interface Client {
  id?: string;
  phone: string;
  dog_name: string;
  last_name: string;
  drop_off_by: string;
  signature_data: string; // base64 PNG, the signed waiver
  photo_data?: string | null; // base64 JPEG data URL, resized client-side — shown at kiosk sign-in/out
  // The dog itself. Mostly populated by importing an existing system's
  // export; all optional, since the kiosk signup only asks for the basics.
  breed?: string | null;
  sex?: DogSex | null;
  fixed_status?: FixedStatus | null;
  birthdate?: string | null; // "YYYY-MM-DD"
  weight_lb?: number | null;
  vet?: string | null;
  // Who else may collect this dog, beyond the usual drop_off_by person.
  authorized_pickup?: string | null;
  notes?: string | null;
  // Ids and the photo filename carried over from a previous system, kept so
  // an import can be reconciled or re-run against the source export.
  external_id?: string | null;
  photo_filename?: string | null;
  // Set by staff when a waiver was signed outside the kiosk (on paper, or
  // at another location) so a dog added from the owner profile isn't
  // flagged as unsigned forever. A real signature in signature_data counts
  // on its own — see hasWaiver() in lib/clients.ts.
  waiver_on_file?: boolean | null;
  created_at?: string;
}

export const SERVICE_TYPES: { key: ServiceType; label: string; icon: string }[] = [
  { key: "daycare", label: "Daycare", icon: "🐕" },
  { key: "boarding", label: "Boarding", icon: "🛏️" },
  { key: "meet_greet", label: "Meet & greet", icon: "✨" },
];

export const ADDONS: { key: AddonKey; label: string; icon: string }[] = [
  { key: "bath", label: "Bath", icon: "🛁" },
  { key: "walk", label: "Walk", icon: "🚶" },
  { key: "nail_trim", label: "Nail trim", icon: "💅" },
];

// Add-ons selectable on a boarding reservation (separate list from the
// daycare walk-in ADDONS above — boarding also offers medications, and
// "walk" needs a per-day count rather than being a flat one-time thing).
export type BoardingAddonKey = "walk" | "bath" | "nail_trim" | "medication";

export const BOARDING_ADDONS: { key: BoardingAddonKey; label: string; icon: string }[] = [
  { key: "walk", label: "Walks", icon: "🚶" },
  { key: "bath", label: "Bath", icon: "🛁" },
  { key: "nail_trim", label: "Nail trim", icon: "💅" },
  { key: "medication", label: "Medication", icon: "💊" },
];

// A staff-created advance boarding reservation. The kiosk checks this
// before allowing a boarding drop-off — see components/KioskForm.tsx.
export interface Boarding {
  id?: string;
  dog_name: string;
  last_name: string;
  phone: string;
  client_id?: string | null;
  start_date: string; // "YYYY-MM-DD"
  end_date: string; // "YYYY-MM-DD"
  feeding_instructions?: string;
  notes?: string;
  addons?: BoardingAddonKey[];
  walks_per_day?: number | null; // only meaningful when addons includes "walk"
  bath_size?: BathSize | null; // only meaningful when addons includes "bath"
  medication_instructions?: string | null; // only meaningful when addons includes "medication"
  photo_data?: string | null; // base64 JPEG data URL, resized client-side — printed on /report
  created_at?: string;
}

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

// One meal-log entry for a given boarding reservation/day, logged by
// staff on the /report page and included on the printed PDF.
export interface MealLog {
  id?: string;
  boarding_id: string;
  date: string; // "YYYY-MM-DD"
  meal_type: MealType;
  fed: boolean;
  fed_by?: string | null; // staff name who fed the dog
  notes?: string;
  created_at?: string;
}

export const MEAL_TYPES: { key: MealType; label: string }[] = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
  { key: "snack", label: "Snack" },
];

// One walk entry for a boarding stay, per day and per walk slot. A
// daycare walk is stored on the sign-in row itself (see the walk_* fields
// on SignInRecord) — a boarding stay can't be, since one reservation
// spans many days and can have several walks a day.
export interface WalkLog {
  id?: string;
  boarding_id: string;
  date: string; // "YYYY-MM-DD"
  walk_index: number; // 0-based slot within that day, for walks_per_day > 1
  walk_out?: string | null;
  walk_in?: string | null;
  staff_initials?: string | null;
  created_at?: string;
}

// The person behind a phone number. `clients` is one row per DOG, so this
// is where owner-level details live — keyed by phone, the same key every
// lookup in the app already uses. Created lazily the first time staff save
// something on an owner profile.
export interface Owner {
  id?: string;
  phone: string;
  owner_name?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  external_id?: string | null; // the previous system's owner id
  emergency_name?: string | null;
  emergency_phone?: string | null;
  emergency_relation?: string | null;
  notes?: string | null;
  created_at?: string;
}

export type VaccineKey = "rabies" | "dhpp" | "bordetella" | "influenza" | "leptospirosis";

// One row per (dog, vaccine). The vaccine list is fixed — staff only fill
// in dates, so records stay comparable across dogs.
export interface Vaccination {
  id?: string;
  client_id: string;
  vaccine: VaccineKey;
  given_on?: string | null; // "YYYY-MM-DD"
  expires_on?: string | null; // "YYYY-MM-DD"
  created_at?: string;
}

export const VACCINES: { key: VaccineKey; label: string }[] = [
  { key: "rabies", label: "Rabies" },
  { key: "dhpp", label: "DHPP" },
  { key: "bordetella", label: "Bordetella" },
  { key: "influenza", label: "Canine influenza" },
  { key: "leptospirosis", label: "Leptospirosis" },
];

// A single package day being consumed. `packages.days_used` is just a
// counter — this is the ledger that gives that counter dates, so staff can
// see which visits burned which days.
export interface PackageUse {
  id?: string;
  package_id: string;
  client_id?: string | null;
  signin_id?: string | null;
  dog_name?: string | null;
  used_on: string; // "YYYY-MM-DD"
  created_at?: string;
}
