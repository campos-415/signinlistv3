"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { BATH_PRICES, estimatePrice, isFullDayVisit, PriceEstimate } from "@/lib/pricing";
import {
  AddonKey,
  ADDONS,
  BathSize,
  Boarding,
  Dog,
  Package,
  ServiceType,
  SERVICE_TYPES,
  PackageKind,
  PackageUse,
  SignInRecord,
  WalkLog,
} from "@/types";
import { isStaffUnlocked, markStaffUnlocked } from "@/lib/staffAuth";
import {
  daysLeft,
  findDog,
  findPackageFor,
  eligiblePackagesFor,
  packageBillingPickUp,
  packageLabel,
  packageKind,
  packagesBoughtOn,
} from "@/lib/dogs";
import StaffNav from "@/components/StaffNav";
import DateField from "@/components/DateField";
import { useSettings } from "@/components/SettingsProvider";
import DogLink from "@/components/DogLink";
import StaffCheckIn from "@/components/StaffCheckIn";

const PASSCODE = process.env.NEXT_PUBLIC_RECORDS_PASSCODE;
const BATH_SIZES: BathSize[] = ["S", "M", "L"];

type SortKey =
  | "dog_name"
  | "status"
  | "last_name"
  | "phone"
  | "service"
  | "drop_off_by"
  | "pick_up_time"
  | "drop_off_time"
  | "pick_up_by"
  | "price";

// A dog is still here if it was dropped off and no pick-up has been logged
// after it. A row with only a pick-up (a manual correction) counts as gone.
function isStillIn(r: MergedRow): boolean {
  return !!r.drop_off_time && !r.pick_up_time;
}

const SORT_LABELS: Record<SortKey, string> = {
  dog_name: "dog",
  status: "status",
  last_name: "last name",
  phone: "phone",
  service: "service",
  drop_off_by: "drop-off by",
  drop_off_time: "drop-off time",
  pick_up_by: "picked-up by",
  pick_up_time: "pick-up time",
  price: "price",
};

function timeValue(iso?: string): number | null {
  return iso ? new Date(iso).getTime() : null;
}

// Blank cells always sort last, in both directions — a dog still here has no
// pick-up time, and reversing the column shouldn't float it to the top as if
// it were the earliest. Direction is applied only to real comparisons.
function compareBy(
  a: string | number | null,
  b: string | number | null,
  dir: 1 | -1
): number {
  const aBlank = a == null || a === "";
  const bBlank = b == null || b === "";
  if (aBlank && bBlank) return 0;
  if (aBlank) return 1;
  if (bBlank) return -1;
  const cmp =
    typeof a === "string" && typeof b === "string" ? a.localeCompare(b) : Number(a) - Number(b);
  return cmp * dir;
}

type WalkField = "walk_out" | "walk_in" | "walk_staff_initials";

// One line on the printable walk log. Daycare and boarding walks come from
// different tables and save differently, so each row carries its own save
// function and the table just renders them.
interface WalkRow {
  key: string;
  service: "daycare" | "boarding";
  // Present on daycare rows: the merged visit behind this walk, so its walk
  // package can be resolved and changed from the log.
  row?: MergedRow;
  dogName: string;
  phone: string;
  dogId?: string;
  handler: string;
  slot: string;
  out: string;
  back: string;
  initials: string;
  save: (field: WalkField, value: string) => void;
}

interface MergedRow {
  key: string;
  dateKey: string;
  dog_name: string;
  last_name: string;
  drop_off_by: string;
  pick_up_by: string;
  phone: string;
  drop_off_id?: string; // most recent drop-off row — used for display/edit
  pick_up_id?: string; // most recent pick-up row — used for display/edit
  allIds: string[]; // every row (including duplicates) for this dog/day — used for delete
  drop_off_time?: string;
  pick_up_time?: string;
  service_type?: ServiceType;
  addons?: string[];
  bath_size?: BathSize | null;
  price?: number | null;
  walk_out?: string | null;
  walk_in?: string | null;
  walk_staff_initials?: string | null;
  pickup_window?: string | null;
  // Set when the pick-up landed on a different day from the drop-off, so a
  // multi-day boarding stay still appears on the day the dog went home.
  pickUpDateKey?: string;
}

interface EditState {
  last_name: string;
  drop_off_by: string;
  pick_up_by: string;
  service_type: ServiceType;
  addons: AddonKey[];
  drop_off_time: string; // "HH:MM" 24h, input[type=time] format
  pick_up_time: string;
  price: string; // input value; parsed to number/null on save
  bath_size: BathSize | null;
  package_id: string; // "" means this visit spent no package day
}

function localDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// One row per VISIT, not per dog-day. Rows are paired sequentially: a
// drop-off opens a visit and the next pick-up for that dog closes it.
//
// Keying on dog+phone+date instead would collapse a dog that comes back a
// second time the same day into a single row — the second drop-off
// overwrites the first, the last pick-up's price wins, and one of the two
// visits is invisible along with whatever it was charged.
function mergeRecords(records: SignInRecord[]): MergedRow[] {
  const sorted = [...records].sort(
    (a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime()
  );

  const byDog = new Map<string, SignInRecord[]>();
  for (const r of sorted) {
    if (!r.created_at) continue;
    const k = `${r.dog_name.trim().toLowerCase()}|${r.phone}`;
    const list = byDog.get(k) ?? [];
    list.push(r);
    byDog.set(k, list);
  }

  const rows: MergedRow[] = [];

  function blank(r: SignInRecord): MergedRow {
    return {
      key: `${r.dog_name}|${r.phone}|${r.id ?? r.created_at}`,
      dateKey: localDateKey(r.created_at as string),
      dog_name: r.dog_name,
      last_name: r.last_name,
      drop_off_by: "",
      pick_up_by: "",
      phone: r.phone,
      allIds: [],
    };
  }

  byDog.forEach((visits) => {
    let open: MergedRow | null = null;
    for (const r of visits) {
      if (r.action === "drop_off") {
        // A drop-off with no pick-up before it means the previous visit was
        // never closed out — keep it rather than losing it to the overwrite.
        if (open) rows.push(open);
        open = blank(r);
        if (r.id) open.allIds.push(r.id);
        open.drop_off_id = r.id;
        open.drop_off_time = r.created_at;
        open.drop_off_by = r.drop_off_by || "";
        open.service_type = r.service_type;
        open.addons = r.addons;
        open.bath_size = r.bath_size ?? null;
        open.walk_out = r.walk_out ?? null;
        open.walk_in = r.walk_in ?? null;
        open.walk_staff_initials = r.walk_staff_initials ?? null;
        open.pickup_window = r.pickup_window ?? null;
      } else {
        // A pick-up with no open drop-off is a manual correction; it still
        // gets a row so its price is visible.
        const row = open ?? blank(r);
        if (r.id) row.allIds.push(r.id);
        row.pick_up_id = r.id;
        row.pick_up_time = r.created_at;
        row.pick_up_by = r.pick_up_by || row.pick_up_by;
        row.price = r.price ?? row.price;
        row.pickUpDateKey = localDateKey(r.created_at as string);
        if (!row.service_type) row.service_type = r.service_type;
        rows.push(row);
        open = null;
      }
    }
    if (open) rows.push(open);
  });

  return rows.sort(
    (a, b) =>
      new Date(b.drop_off_time ?? b.pick_up_time ?? 0).getTime() -
      new Date(a.drop_off_time ?? a.pick_up_time ?? 0).getTime()
  );
}

// A column header that sorts: first click ascending, second descending,
// third back to the default service grouping. Renders as plain text when
// printed, since a print-out has no sort affordance.
function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" } | null;
  onSort: (key: SortKey) => void;
}) {
  const active = sort?.key === sortKey;
  return (
    <th className="px-4 py-3 print:border print:border-paper-rule print:px-2 print:py-1.5">
      <button
        onClick={() => onSort(sortKey)}
        title={`Sort by ${label.replace(/^\W+\s*/, "")}`}
        className={`inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-ink-2 print:pointer-events-none ${
          active ? "font-semibold text-accent-600" : ""
        }`}
      >
        {label}
        <span className={`text-[9px] print:hidden ${active ? "" : "text-ink-3"}`}>
          {active ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

function timeOnly(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// "2026-08-06" + "15:04" -> ISO string for created_at, keeping the same
// calendar day the record is filed under.
function combineDateTime(dateKey: string, time: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  return new Date(y, m - 1, d, h, min).toISOString();
}

function isoToTimeInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function RecordsPage() {
  const { settings } = useSettings();
  const business = settings.business;

  const [unlocked, setUnlocked] = useState(false);
  const [entered, setEntered] = useState("");
  const [error, setError] = useState("");
  const [records, setRecords] = useState<SignInRecord[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  // The package-use ledger, so a visit's row knows which package it spent
  // and staff can move that use to a different one.
  const [uses, setUses] = useState<PackageUse[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [breakdownOpenKey, setBreakdownOpenKey] = useState<string | null>(null);
  const [view, setView] = useState<"signins" | "walklog">("signins");
  // Null means the default grouped-by-service view; a key takes over from it.
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  // Staff front-desk panel, collapsed until needed.
  const [deskOpen, setDeskOpen] = useState(false);
  // Set when the dashboard links here for one service — e.g. tapping a bar
  // on its revenue chart.
  const [serviceFilter, setServiceFilter] = useState<ServiceType | null>(null);

  // The dashboard deep-links into this page with ?date=, ?service=, and
  // ?desk=1, so those links land on exactly the view staff expected.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const date = params.get("date");
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) setSelectedDate(date);
    const service = params.get("service");
    if (service === "daycare" || service === "boarding" || service === "meet_greet") {
      setServiceFilter(service);
    }
    if (params.get("desk")) setDeskOpen(true);
  }, []);
  const [dogs, setDogs] = useState<Dog[]>([]);
  const [boardings, setBoardings] = useState<Boarding[]>([]);
  const [walkLogs, setWalkLogs] = useState<WalkLog[]>([]);

  useEffect(() => {
    if (isStaffUnlocked()) setUnlocked(true);
  }, []);

  useEffect(() => {
    if (unlocked) loadAll();
  }, [unlocked]);

  async function loadAll() {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const [signinsRes, usesRes, packagesRes, clientsRes, boardingsRes] = await Promise.all([
        supabase.from("signins").select("*").order("created_at", { ascending: false }).limit(500),
        supabase.from("package_uses").select("*").limit(2000),
        supabase.from("packages").select("*"),
        // Clients back the hover cards and profile links on dog names.
        supabase.from("dogs").select("*"),
        supabase.from("boardings").select("*"),
      ]);
      if (signinsRes.error) throw signinsRes.error;
      if (usesRes.error) throw usesRes.error;
      if (packagesRes.error) throw packagesRes.error;
      setUses((usesRes.data as PackageUse[]) ?? []);
      if (clientsRes.error) throw clientsRes.error;
      if (boardingsRes.error) throw boardingsRes.error;
      setRecords((signinsRes.data as SignInRecord[]) ?? []);
      setPackages((packagesRes.data as Package[]) ?? []);
      setDogs((clientsRes.data as Dog[]) ?? []);
      setBoardings((boardingsRes.data as Boarding[]) ?? []);
    } catch (e) {
      console.error("Loading records failed:", e);
      setError("Could not load records.");
    } finally {
      setLoading(false);
    }
  }

  // Walk entries for the boarding stays covering the selected date. Kept
  // separate from `records` because a stay's walks aren't sign-ins — one
  // reservation spans many days with several walks a day.
  const loadWalkLogs = useCallback(async () => {
    const stayIds = boardings
      .filter((b) => b.start_date <= selectedDate && b.end_date >= selectedDate)
      .map((b) => b.id)
      .filter(Boolean) as string[];
    if (!stayIds.length) {
      setWalkLogs([]);
      return;
    }
    try {
      const supabase = getSupabase();
      const { data, error: err } = await supabase
        .from("walk_logs")
        .select("*")
        .in("boarding_id", stayIds)
        .eq("date", selectedDate);
      if (err) throw err;
      setWalkLogs((data as WalkLog[]) ?? []);
    } catch (e) {
      console.error("Loading walk logs failed:", e);
    }
  }, [boardings, selectedDate]);

  useEffect(() => {
    if (unlocked) loadWalkLogs();
  }, [unlocked, loadWalkLogs]);

  // Packages looked up live per row — prefers a package tied to that
  // specific dog (dog_name set), falling back to a phone-only package
  // shared across every dog on that number (dog_name left blank).
  const packagesByPhone = useMemo(() => {
    const map = new Map<string, Package[]>();
    for (const p of packages) {
      if (!p.phone) continue;
      const list = map.get(p.phone) ?? [];
      list.push(p);
      map.set(p.phone, list);
    }
    return map;
  }, [packages]);

  function findPackage(phone: string, dogName: string): Package | null {
    const candidates = packagesByPhone.get(phone) ?? [];
    const byDog = candidates
      .filter((p) => p.dog_name && p.dog_name.trim().toLowerCase() === dogName.trim().toLowerCase())
      .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
    if (byDog.length) return byDog[0];
    const shared = candidates
      .filter((p) => !p.dog_name)
      .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
    return shared[0] ?? null;
  }

  function checkPasscode() {
    if (entered === PASSCODE) {
      markStaffUnlocked();
      setUnlocked(true);
      setError("");
    } else {
      setError("Wrong passcode.");
    }
  }

  // A price estimate for the visit — live (using the current time as a
  // stand-in pick-up) if the dog hasn't been picked up yet, or
  // reconstructed from the actual recorded times once it has. A package
  // only ever covers a FULL daycare day, decided against whichever
  // pick-up time is used here.
  // The ledger row this visit spent, for a given package kind.
  //
  // Filtering by kind matters: a visit can spend a daycare day AND a walk on
  // the same pick-up, and the records picker only offers daycare packages —
  // without it a walk use gets handed to a daycare dropdown that has no such
  // option.
  //
  // `signin_id` pins a use to one exact visit. Rows written before that
  // column existed only have dog + date, which is ambiguous once a dog
  // visits twice in a day; rather than guess wrong, those resolve to null and
  // the picker shows "No package used" until staff set it explicitly.
  function useForRow(r: MergedRow, kind: PackageKind = "daycare"): PackageUse | null {
    const ofKind = (u: PackageUse) => {
      const pkg = packages.find((p) => p.id === u.package_id);
      return !!pkg && packageKind(pkg) === kind;
    };

    if (r.pick_up_id) {
      const exact = uses.find((u) => u.signin_id === r.pick_up_id && ofKind(u));
      if (exact) return exact;
    }

    const dog = findDog(dogs, { dogName: r.dog_name, phone: r.phone });
    const legacy = uses.filter(
      (u) =>
        !u.signin_id &&
        u.used_on === r.dateKey &&
        ofKind(u) &&
        (dog?.id
          ? u.dog_id === dog.id
          : (u.dog_name ?? "").trim().toLowerCase() === r.dog_name.trim().toLowerCase())
    );
    // Exactly one candidate is unambiguous; more than one isn't attributable.
    return legacy.length === 1 ? legacy[0] : null;
  }

  // Moves a visit's package day from one block to another: refund the old,
  // deduct the new, and repoint the ledger row so history stays truthful.
  async function reassignPackage(
    r: MergedRow,
    nextPackageId: string,
    kind: PackageKind = "daycare"
  ) {
    const existing = useForRow(r, kind);
    const currentId = existing?.package_id ?? "";
    if (currentId === nextPackageId) return;
    const supabase = getSupabase();

    const older = packages.find((p) => p.id === currentId);
    if (older?.id) {
      await supabase
        .from("packages")
        .update({ days_used: Math.max(0, older.days_used - 1) })
        .eq("id", older.id);
    }
    const next = packages.find((p) => p.id === nextPackageId);
    if (next?.id) {
      await supabase
        .from("packages")
        .update({ days_used: Math.min(next.total_days, next.days_used + 1) })
        .eq("id", next.id);
    }

    if (existing?.id && nextPackageId) {
      await supabase.from("package_uses").update({ package_id: nextPackageId }).eq("id", existing.id);
    } else if (existing?.id && !nextPackageId) {
      await supabase.from("package_uses").delete().eq("id", existing.id);
    } else if (nextPackageId) {
      await supabase.from("package_uses").insert({
        package_id: nextPackageId,
        dog_id: findDog(dogs, { dogName: r.dog_name, phone: r.phone })?.id ?? null,
        signin_id: r.pick_up_id ?? null,
        dog_name: r.dog_name,
        used_on: r.dateKey,
      });
    }
    if (r.pick_up_id) {
      await supabase
        .from("signins")
        .update({ package_id: nextPackageId || null })
        .eq("id", r.pick_up_id);
    }
  }

  function computeEstimate(r: MergedRow, pkg: Package | null): PriceEstimate | null {
    if (!r.drop_off_time || !r.service_type) return null;
    const dropOff = new Date(r.drop_off_time);
    // No pick-up row yet means the dog is still here, so "now" is only a
    // stand-in — a boarding stay mid-run hasn't earned the last-day
    // late-pickup fee just because it's past noon today.
    const pickedUp = !!r.pick_up_time;
    const pickUp = pickedUp ? new Date(r.pick_up_time as string) : new Date();
    const usingPackage = !!pkg && r.service_type === "daycare" && isFullDayVisit(dropOff, pickUp);
    // A package bought on this same day is part of what the client pays for
    // this visit; one bought earlier isn't — those days are already paid for.
    // Only sales not already charged to an earlier pick-up that day — a dog
    // that came back for a second visit shouldn't be billed the package twice.
    // A sale belongs to exactly one visit — the first pick-up after it. Show
    // it on that visit's estimate, and on a not-yet-picked-up visit when no
    // pick-up has claimed it yet.
    const pricedPickUpsThatDay = records.filter(
      (s2) =>
        s2.phone === r.phone &&
        s2.action === "pick_up" &&
        s2.price != null &&
        !!s2.created_at &&
        localDateKey(s2.created_at) === r.dateKey
    );
    const sold = packagesBoughtOn(packages, r.phone, r.dog_name, r.dateKey).filter((p) => {
      const owner = packageBillingPickUp(p, pricedPickUpsThatDay);
      return owner ? owner.id === r.pick_up_id : !r.pick_up_id;
    });
    // A walk package covers the walk add-on the same way a daycare package
    // covers the base rate.
    const walkPkg = findPackageFor(packages, r.phone, r.dog_name, "walk");
    const walkCovered =
      !!walkPkg && (r.addons ?? []).includes("walk") && daysLeft(walkPkg) > 0;
    return estimatePrice(
      r.service_type,
      dropOff,
      pickUp,
      r.addons ?? [],
      usingPackage,
      r.bath_size ?? null,
      pickedUp,
      sold.map((p) => ({
        days: p.total_days,
        price: p.price ?? 0,
        unit: packageKind(p) === "walk" ? "walks" : "days",
      })),
      walkCovered
    );
  }

  const merged = useMemo(() => mergeRecords(records), [records]);
  const SERVICE_ORDER: Record<string, number> = { daycare: 0, boarding: 1, meet_greet: 2 };
  const filtered = useMemo(() => {
    const rows = merged
      .filter((r) => r.dateKey === selectedDate || r.pickUpDateKey === selectedDate)
      .filter((r) => !serviceFilter || r.service_type === serviceFilter);

    // No explicit sort means the default view: grouped by service, most
    // recent first inside each group.
    if (!sort) {
      return rows.sort((a, b) => {
        const orderA = SERVICE_ORDER[a.service_type ?? ""] ?? 99;
        const orderB = SERVICE_ORDER[b.service_type ?? ""] ?? 99;
        if (orderA !== orderB) return orderA - orderB;
        return 0; // stable sort keeps merged's existing recency order within the group
      });
    }

    const dir: 1 | -1 = sort.dir === "asc" ? 1 : -1;
    const key = sort.key;
    return rows.sort((a, b) => compareBy(sortValue(a, key), sortValue(b, key), dir));
  }, [merged, selectedDate, serviceFilter, sort]);

  // Sorting a column replaces the service grouping, so the service is shown
  // as a badge on each row instead (see the Dog cell below).
  function sortValue(r: MergedRow, key: SortKey): string | number | null {
    switch (key) {
      case "dog_name":
        return r.dog_name;
      // In-house first when ascending — that's the list staff actually act on.
      case "status":
        return isStillIn(r) ? 0 : 1;
      case "last_name":
        return r.last_name;
      case "phone":
        return r.phone;
      case "service":
        return SERVICE_ORDER[r.service_type ?? ""] ?? 99;
      case "drop_off_by":
        return r.drop_off_by;
      case "pick_up_by":
        return r.pick_up_by;
      case "drop_off_time":
        return timeValue(r.drop_off_time);
      case "pick_up_time":
        return timeValue(r.pick_up_time);
      case "price":
        return priceValue(r);
      default:
        return null;
    }
  }

  // Whichever price the row displays — the final one once set, otherwise the
  // running estimate, so sorting matches what staff can see.
  function priceValue(r: MergedRow): number | null {
    if (r.price != null) return r.price;
    const estimate = computeEstimate(r, findPackage(r.phone, r.dog_name));
    return estimate?.amount ?? null;
  }

  function toggleSort(key: SortKey) {
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null; // third click returns to the grouped default
    });
  }

  // Every walk owed on the selected date, from both sources: daycare dogs
  // who added a walk at drop-off (stored on their sign-in row) and boarding
  // dogs whose stay covers today (stored per day/slot in walk_logs, since
  // one stay spans many days and can have several walks a day).
  const stillInCount = useMemo(() => filtered.filter(isStillIn).length, [filtered]);

  const walkRows: WalkRow[] = useMemo(() => {
    const daycare: WalkRow[] = filtered
      .filter((r) => r.service_type === "daycare" && r.addons?.includes("walk"))
      .map((r) => ({
        key: `daycare-${r.key}`,
        service: "daycare",
        row: r,
        dogName: r.dog_name,
        phone: r.phone,
        dogId: undefined,
        handler: r.drop_off_by,
        slot: "Walk",
        out: r.walk_out ?? "",
        back: r.walk_in ?? "",
        initials: r.walk_staff_initials ?? "",
        save: (field, value) => saveWalkField(r, field, value),
      }));

    const boarding: WalkRow[] = [];
    for (const b of boardings) {
      if (b.start_date > selectedDate || b.end_date < selectedDate) continue;
      if (!(b.addons ?? []).includes("walk")) continue;
      const perDay = Math.max(1, b.walks_per_day ?? 1);
      for (let i = 0; i < perDay; i++) {
        const entry = walkLogs.find((w) => w.boarding_id === b.id && w.walk_index === i);
        boarding.push({
          key: `boarding-${b.id}-${i}`,
          service: "boarding",
          dogName: b.dog_name,
          phone: b.phone,
          dogId: b.dog_id ?? undefined,
          handler: b.last_name,
          slot: perDay > 1 ? `Walk ${i + 1} of ${perDay}` : "Walk",
          out: entry?.walk_out ?? "",
          back: entry?.walk_in ?? "",
          initials: entry?.staff_initials ?? "",
          save: (field, value) => saveBoardingWalkField(b, i, field, value),
        });
      }
    }

    return [...daycare, ...boarding];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, boardings, walkLogs, selectedDate]);

  const prettyDate = useMemo(() => {
    const [y, m, d] = selectedDate.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }, [selectedDate]);

  const printedAt = useMemo(
    () => new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
    [filtered] // eslint-disable-line react-hooks/exhaustive-deps
  );

  function startEdit(row: MergedRow) {
    setEditingKey(row.key);
    setEditState({
      last_name: row.last_name,
      drop_off_by: row.drop_off_by,
      pick_up_by: row.pick_up_by,
      service_type: row.service_type ?? "daycare",
      addons: (row.addons as AddonKey[]) ?? [],
      drop_off_time: isoToTimeInput(row.drop_off_time),
      pick_up_time: isoToTimeInput(row.pick_up_time),
      price: row.price != null ? String(row.price) : "",
      bath_size: row.bath_size ?? null,
      package_id: useForRow(row, "daycare")?.package_id ?? "",
    });
  }

  function cancelEdit() {
    setEditingKey(null);
    setEditState(null);
  }

  function toggleEditAddon(key: AddonKey) {
    setEditState((prev) =>
      prev
        ? { ...prev, addons: prev.addons.includes(key) ? prev.addons.filter((a) => a !== key) : [...prev.addons, key] }
        : prev
    );
  }

  // Clicking a bath size sets/toggles it and adjusts the price field by
  // swapping out any previously-applied bath amount for the new one —
  // clicking the same size again removes the bath charge entirely. The
  // price field stays freely editable afterward for further adjustments.
  function selectBathSize(size: BathSize) {
    setEditState((prev) => {
      if (!prev) return prev;
      const oldAmount = prev.bath_size ? BATH_PRICES[prev.bath_size] : 0;
      const turningOff = prev.bath_size === size;
      const newAmount = turningOff ? 0 : BATH_PRICES[size];
      const currentPrice = parseFloat(prev.price) || 0;
      const updatedPrice = Math.max(0, currentPrice - oldAmount + newAmount);
      return { ...prev, bath_size: turningOff ? null : size, price: updatedPrice.toFixed(2) };
    });
  }

  async function saveEdit(row: MergedRow) {
    if (!editState) return;
    setSavingEdit(true);
    setError("");
    try {
      const supabase = getSupabase();

      if (row.drop_off_id) {
        const { error: err } = await supabase
          .from("signins")
          .update({
            last_name: editState.last_name.trim(),
            drop_off_by: editState.drop_off_by.trim(),
            service_type: editState.service_type,
            addons: editState.addons,
            bath_size: editState.addons.includes("bath") ? editState.bath_size : null,
            created_at: editState.drop_off_time
              ? combineDateTime(row.dateKey, editState.drop_off_time)
              : row.drop_off_time,
          })
          .eq("id", row.drop_off_id);
        if (err) throw err;
      }
      if (row.pick_up_id) {
        const parsedPrice = editState.price.trim() === "" ? null : parseFloat(editState.price);
        const { error: err } = await supabase
          .from("signins")
          .update({
            last_name: editState.last_name.trim(),
            pick_up_by: editState.pick_up_by.trim(),
            service_type: editState.service_type,
            price: parsedPrice !== null && !Number.isNaN(parsedPrice) ? parsedPrice : null,
            created_at: editState.pick_up_time
              // The pick-up keeps its own day — a boarding stay's pick-up is
              // often not the drop-off date, and reusing that would drag it
              // back across the calendar.
              ? combineDateTime(row.pickUpDateKey ?? row.dateKey, editState.pick_up_time)
              : row.pick_up_time,
          })
          .eq("id", row.pick_up_id);
        if (err) throw err;
      }

      // Moving the day between packages touches three tables, so it runs as
      // its own step rather than being folded into the row updates above.
      await reassignPackage(row, editState.package_id);

      cancelEdit();
      loadAll();
    } catch (e) {
      console.error("Saving edit failed:", e);
      setError("Could not save changes.");
    } finally {
      setSavingEdit(false);
    }
  }

  // Saves one walk-log field straight to the drop-off row as staff type it
  // in — no separate edit/save step, since this is meant for quick entry
  // while walking dogs throughout the day.
  async function saveWalkField(row: MergedRow, field: "walk_out" | "walk_in" | "walk_staff_initials", value: string) {
    if (!row.drop_off_id) return;
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase
        .from("signins")
        .update({ [field]: value.trim() || null })
        .eq("id", row.drop_off_id);
      if (err) throw err;
      setRecords((prev) => prev.map((r) => (r.id === row.drop_off_id ? { ...r, [field]: value.trim() || null } : r)));
    } catch (e) {
      console.error("Saving walk log failed:", e);
      setError("Could not save the walk log.");
    }
  }

  // Same idea for a boarding walk, but keyed by stay + day + slot in
  // walk_logs rather than living on a sign-in row.
  async function saveBoardingWalkField(
    boarding: Boarding,
    walkIndex: number,
    field: WalkField,
    value: string
  ) {
    if (!boarding.id) return;
    const trimmed = value.trim() || null;
    const column =
      field === "walk_staff_initials" ? "staff_initials" : (field as "walk_out" | "walk_in");
    const existing = walkLogs.find((w) => w.boarding_id === boarding.id && w.walk_index === walkIndex);
    const next: WalkLog = {
      ...(existing ?? {
        boarding_id: boarding.id,
        date: selectedDate,
        walk_index: walkIndex,
      }),
      [column]: trimmed,
    } as WalkLog;
    setWalkLogs((prev) => [
      ...prev.filter((w) => !(w.boarding_id === boarding.id && w.walk_index === walkIndex)),
      next,
    ]);
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase.from("walk_logs").upsert(
        {
          boarding_id: boarding.id,
          date: selectedDate,
          walk_index: walkIndex,
          walk_out: next.walk_out ?? null,
          walk_in: next.walk_in ?? null,
          staff_initials: next.staff_initials ?? null,
        },
        { onConflict: "boarding_id,date,walk_index" }
      );
      if (err) throw err;
    } catch (e) {
      console.error("Saving boarding walk log failed:", e);
      setError("Could not save the walk log.");
    }
  }

  async function deleteRow(row: MergedRow) {
    const label = `${row.dog_name}'s visit on ${row.dateKey}`;
    const extra = row.allIds.length > 2 ? " (including some duplicate sign-ins found for this day)" : "";
    if (
      !window.confirm(`Delete ${label}?${extra} This removes the entire entry and can't be undone.`)
    ) {
      return;
    }
    setDeletingKey(row.key);
    setError("");
    try {
      const supabase = getSupabase();
      if (row.allIds.length) {
        const { error: err } = await supabase.from("signins").delete().in("id", row.allIds);
        if (err) throw err;
      }
      loadAll();
    } catch (e) {
      console.error("Deleting record failed:", e);
      setError("Could not delete this record.");
    } finally {
      setDeletingKey(null);
    }
  }

  if (!unlocked) {
    return (
      <div className="mx-auto mt-28 flex max-w-xs flex-col gap-3 px-5">
        <h1 className="font-display text-xl font-semibold text-ink">Staff records</h1>
        <input
          type="password"
          value={entered}
          onChange={(e) => setEntered(e.target.value)}
          placeholder="Passcode"
          onKeyDown={(e) => e.key === "Enter" && checkPasscode()}
          className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
        />
        <button
          onClick={checkPasscode}
          className="rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-medium text-white shadow-card hover:bg-accent-600"
        >
          Unlock
        </button>
        {error && <p className="text-xs font-medium text-rose-500">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 print:px-0 print:py-0">
      <style>{`
        @media print {
          @page { margin: 0.4in; size: portrait; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          table { font-size: 6px; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; }
          .print-header {
            background: linear-gradient(135deg, rgb(var(--print-from)) 0%, rgb(var(--print-to)) 100%);
            border-radius: 20px;
            position: relative;
            overflow: hidden;
          }
          .print-paw {
            position: absolute;
            font-size: 48px;
            opacity: 0.15;
            transform: rotate(-15deg);
          }
          tbody tr:nth-child(even) td { background: rgb(var(--print-tint)); }
          .print-footer {
            text-align: center;
            color: rgb(var(--print-ink));
            font-size: 8px;
            margin-top: 10px;
          }
        }
      `}</style>

      <StaffNav current="/records" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="font-display text-xl font-semibold text-ink">
          {view === "signins" ? "Sign-in records" : "Walk log"}
          {view === "signins" && stillInCount > 0 && (
            <span className="ml-2.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
              🟢 {stillInCount} still here
            </span>
          )}
        </h1>
        <div className="flex items-center gap-2">
          <DateField
            value={selectedDate}
            onChange={setSelectedDate}
            wrapperClassName="w-40"
            className="rounded-xl border border-line bg-surface px-3.5 py-2 text-sm text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
            ariaLabel="Date"
          />
          <button
            onClick={() => setView(view === "signins" ? "walklog" : "signins")}
            className="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-2 hover:border-line">
            {view === "signins" ? "🚶 Walk log" : "📋 Sign-in list"}
          </button>
          <button
            onClick={() => setDeskOpen((v) => !v)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              deskOpen
                ? "bg-slate-700 text-white shadow-card hover:bg-slate-800"
                : "border border-line bg-surface text-ink-2 hover:border-line"
            }`}>
            {deskOpen ? "✕ Close front desk" : "🚗 Sign a dog in / out"}
          </button>
          <button
            onClick={() => window.print()}
            className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow-card hover:bg-accent-600">
            🖨️ Print / Save as PDF
          </button>
        </div>
      </div>

      {/* Front desk — for when a client doesn't use the lobby kiosk. Writes
          through the same path the kiosk does, and reloads the list after. */}
      {deskOpen && (
        <div className="mb-6 print:hidden">
          <StaffCheckIn onDone={loadAll} />
        </div>
      )}

      {/* Say so when a deep link narrowed the list, or a sort replaced the
          default grouping — otherwise a filtered view reads as a quiet day. */}
      {(serviceFilter || sort) && (
        <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
          {serviceFilter && (
            <>
              <span className="rounded-full bg-accent-50 px-3 py-1 text-xs font-medium text-accent-700">
                Showing {SERVICE_TYPES.find((s) => s.key === serviceFilter)?.label ?? serviceFilter}{" "}
                only
              </span>
              <button
                onClick={() => setServiceFilter(null)}
                className="text-xs font-medium text-ink-3 hover:text-ink-2">
                Show all services
              </button>
            </>
          )}
          {sort && (
            <>
              <span className="rounded-full bg-surface-3 px-3 py-1 text-xs font-medium text-ink-2">
                Sorted by {SORT_LABELS[sort.key]} {sort.dir === "asc" ? "↑" : "↓"}
              </span>
              <button
                onClick={() => setSort(null)}
                className="text-xs font-medium text-ink-3 hover:text-ink-2">
                Back to grouped by service
              </button>
            </>
          )}
        </div>
      )}

      <div className="print-header mb-5 hidden px-6 py-5 print:block">
        <span className="print-paw" style={{ top: -10, right: 30 }}>
          🐾
        </span>
        <span className="print-paw" style={{ bottom: -20, left: "40%" }}>
          🐾
        </span>
        <div className="relative flex items-center justify-between">
          <div>
            <h2 className="font-display text-2xl font-bold text-white">
              🐾 {business.name}
            </h2>
            <p className="text-base font-medium text-white/90">
              {view === "signins" ? "Sign-in list" : "Daycare walk log"} — {prettyDate}
            </p>
          </div>
          <div className="rounded-2xl bg-white/20 px-4 py-2 text-right text-xs font-medium text-white">
            <p>
              {view === "signins"
                ? `${filtered.length} dog${filtered.length === 1 ? "" : "s"} today`
                : `${walkRows.length} walk${walkRows.length === 1 ? "" : "s"} today`}
            </p>
            <p className="text-white/80">Printed {printedAt}</p>
          </div>
        </div>
      </div>

      {loading && (
        <p className="text-sm text-ink-3 print:hidden">Loading…</p>
      )}
      {error && (
        <p className="text-xs font-medium text-rose-500 print:hidden">
          {error}
        </p>
      )}

      {view === "signins" && (
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card print:overflow-visible print:rounded-2xl print:border print:border-paper-rule print:shadow-none">
        <table className="w-full text-left text-sm print:border-collapse">
          <thead>
            <tr className="border-b border-line-soft text-xs font-medium uppercase tracking-wide text-ink-3 print:border-b-2 print:border-paper-rule print:bg-paper-band print:text-paper-ink">
              <SortableTh label="🐕 Dog" sortKey="dog_name" sort={sort} onSort={toggleSort} />
              <SortableTh label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
              <SortableTh label="Last name" sortKey="last_name" sort={sort} onSort={toggleSort} />
              <SortableTh label="Phone" sortKey="phone" sort={sort} onSort={toggleSort} />
              <SortableTh label="Drop off by" sortKey="drop_off_by" sort={sort} onSort={toggleSort} />
              <SortableTh label="Drop off" sortKey="drop_off_time" sort={sort} onSort={toggleSort} />
              <SortableTh label="Picked up by" sortKey="pick_up_by" sort={sort} onSort={toggleSort} />
              <SortableTh label="Pick up" sortKey="pick_up_time" sort={sort} onSort={toggleSort} />
              <th className="px-4 py-3 print:border print:border-paper-rule print:px-2 print:py-1.5">
                Add-ons
              </th>
              <th className="px-4 py-3 print:border print:border-paper-rule print:px-2 print:py-1.5">
                Package
              </th>
              <SortableTh label="Price" sortKey="price" sort={sort} onSort={toggleSort} />
              <th className="px-4 py-3 print:hidden">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const pkg = findPackage(r.phone, r.dog_name);
              const left = pkg
                ? Math.max(0, pkg.total_days - pkg.days_used)
                : null;
              const isEditing = editingKey === r.key;
              // Grouping only makes sense in the default order — once a
              // column is sorted, rows interleave and the group bands would
              // fragment, so the service moves onto the row itself.
              const showGroupHeader =
                !sort && (i === 0 || r.service_type !== filtered[i - 1].service_type);
              const groupInfo = SERVICE_TYPES.find(
                (s) => s.key === r.service_type,
              );
              const groupHeader = showGroupHeader && (
                <tr key={`${r.key}-group`}>
                  <td
                    colSpan={13}
                    className="bg-surface-3 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3 print:border print:border-paper-rule print:bg-paper-band print:px-2 print:text-paper-ink">
                    {groupInfo
                      ? `${groupInfo.icon} ${groupInfo.label}`
                      : "Other"}
                  </td>
                </tr>
              );

              if (isEditing && editState) {
                return (
                  <Fragment key={r.key}>
                    {groupHeader}
                    <tr className="border-b border-line-soft bg-accent-50/40 align-top print:hidden">
                      <td className="px-4 py-3 font-medium text-ink">
                        {r.dog_name}
                      </td>
                      {/* Status is derived from the times below, so it's shown
                          rather than edited — keeps the columns aligned. */}
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">
                          {isStillIn(r) ? "🟢 In" : "✓ Left"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          value={editState.last_name}
                          onChange={(e) =>
                            setEditState({
                              ...editState,
                              last_name: e.target.value,
                            })
                          }
                          className="w-28 rounded-lg border border-line px-2 py-1 text-xs outline-none focus:border-accent-500"
                        />
                      </td>
                      <td className="px-4 py-3 text-ink-3">{r.phone}</td>
                      <td className="px-4 py-3">
                        <input
                          value={editState.drop_off_by}
                          onChange={(e) =>
                            setEditState({
                              ...editState,
                              drop_off_by: e.target.value,
                            })
                          }
                          className="w-28 rounded-lg border border-line px-2 py-1 text-xs outline-none focus:border-accent-500"
                        />
                      </td>

                      <td className="px-4 py-3">
                        {r.drop_off_id ? (
                          <input
                            type="time"
                            value={editState.drop_off_time}
                            onChange={(e) =>
                              setEditState({
                                ...editState,
                                drop_off_time: e.target.value,
                              })
                            }
                            className="w-24 rounded-lg border border-line px-2 py-1 text-xs outline-none focus:border-accent-500"
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <input
                          value={editState.pick_up_by}
                          onChange={(e) =>
                            setEditState({
                              ...editState,
                              pick_up_by: e.target.value,
                            })
                          }
                          className="w-28 rounded-lg border border-line px-2 py-1 text-xs outline-none focus:border-accent-500"
                        />
                      </td>
                      <td className="px-4 py-3">
                        {r.pick_up_id ? (
                          <input
                            type="time"
                            value={editState.pick_up_time}
                            onChange={(e) =>
                              setEditState({
                                ...editState,
                                pick_up_time: e.target.value,
                              })
                            }
                            className="w-24 rounded-lg border border-line px-2 py-1 text-xs outline-none focus:border-accent-500"
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {ADDONS.map((a) => (
                            <button
                              key={a.key}
                              onClick={() => toggleEditAddon(a.key)}
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
                                editState.addons.includes(a.key)
                                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                                  : "border-line bg-surface text-ink-3"
                              }`}>
                              {a.label}
                            </button>
                          ))}
                        </div>
                        {editState.addons.includes("bath") && (
                          <div className="mt-1.5 flex items-center gap-1">
                            <span className="text-[10px] text-ink-3">
                              Bath size:
                            </span>
                            {BATH_SIZES.map((size) => (
                              <button
                                key={size}
                                onClick={() => selectBathSize(size)}
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
                                  editState.bath_size === size
                                    ? "border-sky-500 bg-sky-50 text-sky-700"
                                    : "border-line bg-surface text-ink-3"
                                }`}>
                                {size} ${BATH_PRICES[size]}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-ink-3">
                        {/* Which package this visit spent. Changing it refunds
                            the old block and deducts the new one. */}
                        {(() => {
                          const options = eligiblePackagesFor(
                            packages,
                            r.phone,
                            r.dog_name,
                            "daycare"
                          );
                          if (!options.length) return "—";
                          return (
                            <select
                              value={editState.package_id}
                              onChange={(e) =>
                                setEditState({ ...editState, package_id: e.target.value })
                              }
                              className="w-full rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent-500"
                            >
                              <option value="">No package used</option>
                              {options.map((p) => (
                                <option key={p.id} value={p.id ?? ""}>
                                  {packageLabel(p)}
                                </option>
                              ))}
                            </select>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        {r.pick_up_id ? (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={editState.price}
                            onChange={(e) =>
                              setEditState({
                                ...editState,
                                price: e.target.value,
                              })
                            }
                            placeholder="0.00"
                            className="w-20 rounded-lg border border-line px-2 py-1 text-xs outline-none focus:border-accent-500"
                          />
                        ) : (
                          (() => {
                            const liveEstimate = computeEstimate(r, pkg);
                            return liveEstimate ? (
                              <span
                                className="text-xs text-ink-3"
                                title="Live estimate — finalizes at pick-up">
                                ~${liveEstimate.amount.toFixed(2)}
                              </span>
                            ) : (
                              <span
                                className="text-xs text-ink-3"
                                title="Set once this visit has a pick-up">
                                —
                              </span>
                            );
                          })()
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => saveEdit(r)}
                            disabled={savingEdit}
                            className="rounded-lg bg-accent-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-600 disabled:opacity-60">
                            {savingEdit ? "Saving…" : "Save"}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-3 hover:border-line">
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              }

              const stillIn = isStillIn(r);
              return (
                <Fragment key={r.key}>
                  {groupHeader}
                  {/* A left edge and faint tint make the dogs still on site
                      scannable without reading the times column. */}
                  <tr
                    className={`border-b border-line-soft last:border-0 print:border-b-0 ${
                      stillIn
                        ? "border-l-4 border-l-emerald-400 bg-emerald-50/40 dark:bg-emerald-400/10 print:bg-transparent"
                        : "border-l-4 border-l-transparent"
                    }`}>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-ink print:border print:border-paper-line print:px-2 print:py-1.5">
                      <DogLink
                        dog={findDog(dogs, { dogName: r.dog_name, phone: r.phone })}
                        name={r.dog_name}
                        badges={{ packageDaysLeft: left }}
                        className="font-medium text-ink"
                        avatar
                      />
                      {/* Sorting drops the service group bands, so carry the
                          service here instead of losing it. */}
                      {sort && groupInfo && (
                        <span className="ml-1.5 text-[10px] font-normal text-ink-3">
                          {groupInfo.icon} {groupInfo.label}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 print:border print:border-paper-line print:px-2 print:py-1.5">
                      {stillIn ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-800 print:bg-transparent print:px-0 print:font-bold">
                          🟢 In
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3 print:bg-transparent print:px-0">
                          ✓ Left
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-2 print:border print:border-paper-line print:px-2 print:py-1.5">
                      {r.last_name}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-2 print:border print:border-paper-line print:px-2 print:py-1.5">
                      {r.phone}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-2 print:border print:border-paper-line print:px-2 print:py-1.5">
                      {r.drop_off_by || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-2 print:border print:border-paper-line print:px-2 print:py-1.5">
                      {timeOnly(r.drop_off_time)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-2 print:border print:border-paper-line print:px-2 print:py-1.5">
                      {r.pick_up_by || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-2 print:border print:border-paper-line print:px-2 print:py-1.5">
                      {timeOnly(r.pick_up_time)}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-ink-2 print:border print:border-paper-line print:px-2 print:py-1.5">
                      {r.addons && r.addons.length
                        ? r.addons
                          .map((a) =>
                              
                              a === "bath" && r.bath_size
                                ? `Bath (${r.bath_size})`
                                : a === "bath" ? "Bath"
                                : a === "nail_trim" ? "Nail trim"
                                : a === "walk" ? "Walk" : a
                            )
                          .join(", ")
                        : "—"}
                      {r.pickup_window && (
                        <span className="block text-[10px] text-sky-700">
                          🕑 Pick up {r.pickup_window}
                        </span>
                      )}
                      {/* A bath has no price until it has a size, so an
                          unsized one silently undercharges. Say so loudly
                          rather than letting the dog leave unbilled. */}
                      {r.addons?.includes("bath") && !r.bath_size && (
                        <span className="mt-0.5 block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                          ⚠️ Set bath size to charge it
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-2 print:border print:border-paper-line print:px-2 print:py-1.5">
                      {pkg ? `${left} / ${pkg.total_days}` : "—"}
                    </td>
                    <td className="px-4 py-3 font-medium text-emerald-700 print:border print:border-paper-line print:px-2 print:py-1.5 align-top">
                      {(() => {
                        const estimate = computeEstimate(r, pkg);
                        if (!estimate)
                          return <span className="text-ink-3">—</span>;
                        const finalAmount =
                          r.price != null ? r.price : estimate.amount;
                        const isFinal = r.price != null;
                        const showBreakdown = breakdownOpenKey === r.key;
                        return (
                          <div>
                            <button
                              onClick={() =>
                                setBreakdownOpenKey(
                                  showBreakdown ? null : r.key,
                                )
                              }
                              className="inline-flex items-center gap-1 hover:underline ">
                              ${finalAmount.toFixed(2)}
                              {!isFinal && (
                                <span className="text-[10px] font-normal text-ink-3 print:hidden">
                                  (est.)
                                </span>
                              )}
                              <span className="text-ink-3 print:hidden">🧾</span>
                            </button>
                            {showBreakdown && (
                              <ul className="mt-1 space-y-0.5 text-[10px] font-normal text-ink-3">
                                {estimate.breakdown.map((item, i) => (
                                  <li
                                    key={i}
                                    className="flex justify-between gap-3">
                                    <span>{item.label}</span>
                                    <span>${item.amount.toFixed(2)}</span>
                                  </li>
                                ))}
                                {isFinal &&
                                  Math.abs(finalAmount - estimate.amount) >
                                    0.01 && (
                                    <li className="pt-0.5 text-ink-3">
                                      (price manually adjusted)
                                    </li>
                                  )}
                              </ul>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 print:hidden">
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => startEdit(r)}
                          className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-line">
                          Edit
                        </button>
                        <button
                          onClick={() => deleteRow(r)}
                          disabled={deletingKey === r.key}
                          className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs text-rose-500 hover:border-rose-300 disabled:opacity-60">
                          {deletingKey === r.key ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
            {filtered.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={13}
                  className="px-4 py-6 text-center text-sm text-ink-3 print:border print:border-paper-line">
                  No sign-ins for this date.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {view === "walklog" && (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card print:overflow-visible print:rounded-2xl print:border print:border-paper-rule print:shadow-none">
          <table className="w-full text-left text-sm print:border-collapse">
            <thead>
              <tr className="border-b border-line-soft text-xs font-medium uppercase tracking-wide text-ink-3 print:border-b-2 print:border-paper-rule print:bg-paper-band print:text-paper-ink">
                <th className="px-4 py-3 print:border print:border-paper-rule print:px-2 print:py-1.5">
                  🐕 Dog
                </th>
                <th className="px-4 py-3 print:border print:border-paper-rule print:px-2 print:py-1.5">
                  Walk
                </th>
                <th className="px-4 py-3 print:border print:border-paper-rule print:px-2 print:py-1.5">
                  Walk out
                </th>
                <th className="px-4 py-3 print:border print:border-paper-rule print:px-2 print:py-1.5">
                  Walk in
                </th>
                <th className="px-4 py-3 print:border print:border-paper-rule print:px-2 print:py-1.5">
                  Staff initials
                </th>
                <th className="px-4 py-3 print:hidden">Walk package</th>
              </tr>
            </thead>
            <tbody>
              {walkRows.map((r, i) => {
                const showGroupHeader = i === 0 || r.service !== walkRows[i - 1].service;
                const groupInfo = SERVICE_TYPES.find((s) => s.key === r.service);
                const dog = findDog(dogs, {
                  dogId: r.dogId,
                  dogName: r.dogName,
                  phone: r.phone,
                });
                const pkg = findPackageFor(packages, r.phone, r.dogName);
                return (
                  <Fragment key={r.key}>
                    {showGroupHeader && (
                      <tr>
                        <td
                          colSpan={5}
                          className="bg-surface-3 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3 print:border print:border-paper-rule print:bg-paper-band print:px-2 print:text-paper-ink">
                          {groupInfo ? `${groupInfo.icon} ${groupInfo.label}` : r.service}
                        </td>
                      </tr>
                    )}
                    <tr className="border-b border-line-soft last:border-0 print:border-b-0">
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-ink print:border print:border-paper-line print:px-2 print:py-1.5">
                        <DogLink
                          dog={dog}
                          name={r.dogName}
                          badges={{
                            packageDaysLeft: pkg ? Math.max(0, pkg.total_days - pkg.days_used) : null,
                          }}
                          className="font-medium text-ink"
                          avatar
                        />
                        <span className="block text-[10px] font-normal text-ink-3">
                          {r.handler || "—"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-2 print:border print:border-paper-line print:px-2 print:py-1.5">
                        {r.slot}
                      </td>
                      <td className="px-4 py-3 print:border print:border-paper-line print:px-2 print:py-1.5">
                        <WalkCell
                          cellKey={`${r.key}-out`}
                          value={r.out}
                          placeholder="e.g. 2:15pm"
                          onSave={(v) => r.save("walk_out", v)}
                        />
                      </td>
                      <td className="px-4 py-3 print:border print:border-paper-line print:px-2 print:py-1.5">
                        <WalkCell
                          cellKey={`${r.key}-in`}
                          value={r.back}
                          placeholder="e.g. 2:45pm"
                          onSave={(v) => r.save("walk_in", v)}
                        />
                      </td>
                      <td className="px-4 py-3 print:border print:border-paper-line print:px-2 print:py-1.5">
                        <WalkCell
                          cellKey={`${r.key}-by`}
                          value={r.initials}
                          placeholder="e.g. JS"
                          width="w-16 print:w-14"
                          maxLength={8}
                          onSave={(v) => r.save("walk_staff_initials", v)}
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 print:hidden">
                        {/* A walk package covers the daycare walk add-on, so
                            only daycare rows draw from one — boarding walks
                            are billed per walk on the reservation. */}
                        {r.service === "daycare" && r.row ? (
                          (() => {
                            const options = eligiblePackagesFor(
                              packages,
                              r.phone,
                              r.dogName,
                              "walk"
                            );
                            if (!options.length)
                              return <span className="text-xs text-ink-3">—</span>;
                            const current = useForRow(r.row!, "walk")?.package_id ?? "";
                            return (
                              <select
                                value={current}
                                onChange={async (e) => {
                                  await reassignPackage(r.row!, e.target.value, "walk");
                                  loadAll();
                                }}
                                className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent-500">
                                <option value="">No walk package</option>
                                {options.map((p) => (
                                  <option key={p.id} value={p.id ?? ""}>
                                    {packageLabel(p)}
                                  </option>
                                ))}
                              </select>
                            );
                          })()
                        ) : (
                          <span className="text-xs text-ink-3">—</span>
                        )}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
              {walkRows.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-6 text-center text-sm text-ink-3 print:border print:border-paper-line">
                    No walks booked for this date.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="print-footer hidden print:block">
        🐾 Thanks for a pawsome day! 🐾
      </p>
    </div>
  );
}

// Uncontrolled so typing stays snappy, saving on blur only when the value
// actually changed. Degrades to a dotted line in print so a partly-filled
// sheet is still writable by hand.
function WalkCell({
  cellKey,
  value,
  placeholder,
  width = "w-24 print:w-20",
  maxLength,
  onSave,
}: {
  cellKey: string;
  value: string;
  placeholder: string;
  width?: string;
  maxLength?: number;
  onSave: (value: string) => void;
}) {
  return (
    <input
      key={cellKey}
      defaultValue={value}
      placeholder={placeholder}
      maxLength={maxLength}
      onBlur={(e) => {
        if (e.target.value.trim() !== value.trim()) onSave(e.target.value);
      }}
      className={`${width} rounded-lg border border-line bg-surface px-2 py-1 text-xs outline-none focus:border-accent-500 print:rounded-none print:border-0 print:border-b print:border-dotted print:border-slate-400 print:bg-transparent print:p-0 print:placeholder:text-transparent`}
    />
  );
}
