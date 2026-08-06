import { AddonKey, ServiceType } from "@/types";

// ---------------------------------------------------------------------
// White-labeling this kiosk for a new business: everything below is the
// per-client surface. Name/tagline/icon/color come from env vars (so a
// fresh Vercel deploy with new env vars is enough for those). The
// service and add-on lists are edited directly here since they're more
// than a single value — swap them for whatever the new business offers.
// See README.md "New client checklist" for the full spin-up steps.
// ---------------------------------------------------------------------

export const BUSINESS = {
  name: process.env.NEXT_PUBLIC_BUSINESS_NAME || "Lombard Doggy Daycare",
  tagline: process.env.NEXT_PUBLIC_BUSINESS_TAGLINE || "Sign your pup in or out",
  icon: process.env.NEXT_PUBLIC_BUSINESS_ICON || "🐾", // emoji shown in the badge; swap for a real logo image if you have one (see README)
  accentColor: process.env.NEXT_PUBLIC_ACCENT_COLOR || "#4A72EF",
  bgColor: process.env.NEXT_PUBLIC_BG_COLOR || "#F8FAFC",
};

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
