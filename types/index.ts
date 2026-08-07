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
