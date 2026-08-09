export type SignAction = "drop_off" | "pick_up";
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
  created_at?: string;
}

export interface Package {
  id?: string;
  client_name: string;
  dog_name?: string;
  phone: string;
  total_days: number;
  days_used: number;
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
