"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { fileToResizedDataUrl } from "@/lib/image";
import { daysLeft, findPackageFor, hasWaiver, ownerHref } from "@/lib/clients";
import { dateRange, prettyDateKey, todayKey } from "@/lib/dates";
import {
  STATUS_CLASSES,
  STATUS_LABELS,
  overallVaccineStatus,
  vaccineStatus,
} from "@/lib/vaccines";
import {
  Boarding,
  Client,
  DOG_SEXES,
  DogSex,
  FIXED_STATUSES,
  FixedStatus,
  Package,
  SignInRecord,
  VACCINES,
  VaccineKey,
  Vaccination,
  WalkLog,
} from "@/types";
import StaffGate from "@/components/StaffGate";
import StaffNav from "@/components/StaffNav";

export default function DogProfilePage() {
  return (
    <StaffGate title="Dog profile">
      <DogProfile />
    </StaffGate>
  );
}

interface WalkRow {
  key: string;
  date: string;
  service: "Daycare" | "Boarding";
  slot: string;
  out: string;
  back: string;
  initials: string;
}

function DogProfile() {
  const params = useParams<{ id: string }>();
  const clientId = params?.id;

  const [client, setClient] = useState<Client | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [signins, setSignins] = useState<SignInRecord[]>([]);
  const [boardings, setBoardings] = useState<Boarding[]>([]);
  const [walkLogs, setWalkLogs] = useState<WalkLog[]>([]);
  const [vaccinations, setVaccinations] = useState<Vaccination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoSaved, setInfoSaved] = useState(false);

  // Editable basic-info draft, seeded from the loaded profile.
  const [form, setForm] = useState({
    dog_name: "",
    last_name: "",
    drop_off_by: "",
    breed: "",
    sex: "" as DogSex | "",
    fixed_status: "" as FixedStatus | "",
    birthdate: "",
    weight_lb: "",
    vet: "",
    authorized_pickup: "",
  });

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError("");
    try {
      const supabase = getSupabase();
      const { data: clientRow, error: clientErr } = await supabase
        .from("clients")
        .select("*")
        .eq("id", clientId)
        .single();
      if (clientErr) throw clientErr;
      const dog = clientRow as Client;
      setClient(dog);
      setForm({
        dog_name: dog.dog_name ?? "",
        last_name: dog.last_name ?? "",
        drop_off_by: dog.drop_off_by ?? "",
        breed: dog.breed ?? "",
        sex: dog.sex ?? "",
        fixed_status: dog.fixed_status ?? "",
        birthdate: dog.birthdate ?? "",
        weight_lb: dog.weight_lb != null ? String(dog.weight_lb) : "",
        vet: dog.vet ?? "",
        authorized_pickup: dog.authorized_pickup ?? "",
      });

      // Everything else keys off the dog we just loaded — its id for
      // sign-ins and vaccines, its phone + name for packages and stays,
      // which predate client_id on some rows.
      const [pkgRes, signinRes, boardingRes, vaxRes] = await Promise.all([
        supabase.from("packages").select("*").eq("phone", dog.phone),
        supabase
          .from("signins")
          .select("*")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(400),
        supabase
          .from("boardings")
          .select("*")
          .eq("phone", dog.phone)
          .ilike("dog_name", dog.dog_name)
          .order("start_date", { ascending: false }),
        supabase.from("vaccinations").select("*").eq("client_id", clientId),
      ]);
      if (pkgRes.error) throw pkgRes.error;
      if (signinRes.error) throw signinRes.error;
      if (boardingRes.error) throw boardingRes.error;
      if (vaxRes.error) throw vaxRes.error;

      setPackages((pkgRes.data as Package[]) ?? []);
      setSignins((signinRes.data as SignInRecord[]) ?? []);
      const stays = (boardingRes.data as Boarding[]) ?? [];
      setBoardings(stays);
      setVaccinations((vaxRes.data as Vaccination[]) ?? []);

      const stayIds = stays.map((b) => b.id).filter(Boolean) as string[];
      if (stayIds.length) {
        const { data: walkData, error: walkErr } = await supabase
          .from("walk_logs")
          .select("*")
          .in("boarding_id", stayIds);
        if (walkErr) throw walkErr;
        setWalkLogs((walkData as WalkLog[]) ?? []);
      } else {
        setWalkLogs([]);
      }
    } catch (e) {
      console.error("Loading dog profile failed:", e);
      setError("Could not load this dog's profile.");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveInfo() {
    if (!client?.id) return;
    setSavingInfo(true);
    setError("");
    try {
      const supabase = getSupabase();
      // Built once and reused, so the row written and the local state can't
      // drift — and so the form's "" placeholders become real nulls.
      const patch = {
        dog_name: form.dog_name.trim(),
        last_name: form.last_name.trim(),
        drop_off_by: form.drop_off_by.trim(),
        breed: form.breed.trim() || null,
        sex: form.sex || null,
        fixed_status: form.fixed_status || null,
        birthdate: form.birthdate || null,
        weight_lb: form.weight_lb.trim() === "" ? null : Number(form.weight_lb),
        vet: form.vet.trim() || null,
        authorized_pickup: form.authorized_pickup.trim() || null,
      };
      const { error: err } = await supabase.from("clients").update(patch).eq("id", client.id);
      if (err) throw err;
      setClient({ ...client, ...patch });
      setInfoSaved(true);
      setTimeout(() => setInfoSaved(false), 2000);
    } catch (e) {
      console.error("Saving dog info failed:", e);
      setError("Could not save those changes.");
    } finally {
      setSavingInfo(false);
    }
  }

  async function handlePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !client?.id) return;
    try {
      const dataUrl = await fileToResizedDataUrl(file);
      const supabase = getSupabase();
      const { error: err } = await supabase
        .from("clients")
        .update({ photo_data: dataUrl })
        .eq("id", client.id);
      if (err) throw err;
      setClient({ ...client, photo_data: dataUrl });
    } catch (e) {
      console.error("Saving dog photo failed:", e);
      setError("Could not save that photo — try a different file.");
    }
  }

  // Vaccine dates save as they're entered, one row per (dog, vaccine).
  async function saveVaccine(vaccine: VaccineKey, patch: { given_on?: string; expires_on?: string }) {
    if (!client?.id) return;
    const existing = vaccinations.find((v) => v.vaccine === vaccine);
    const next: Vaccination = {
      ...existing,
      client_id: client.id,
      vaccine,
      given_on: patch.given_on !== undefined ? patch.given_on || null : (existing?.given_on ?? null),
      expires_on:
        patch.expires_on !== undefined ? patch.expires_on || null : (existing?.expires_on ?? null),
    };
    // Optimistic — these are two date inputs, and a round trip per keystroke
    // would make them feel broken.
    setVaccinations((prev) => {
      const rest = prev.filter((v) => v.vaccine !== vaccine);
      return [...rest, next];
    });
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase
        .from("vaccinations")
        .upsert(
          {
            client_id: client.id,
            vaccine,
            given_on: next.given_on,
            expires_on: next.expires_on,
          },
          { onConflict: "client_id,vaccine" }
        );
      if (err) throw err;
    } catch (e) {
      console.error("Saving vaccination failed:", e);
      setError("Could not save that vaccine record.");
    }
  }

  const dogPackage = useMemo(
    () => (client ? findPackageFor(packages, client.phone, client.dog_name) : null),
    [packages, client]
  );

  // Every package on the number that could apply to this dog — its own,
  // plus shared ones with no dog_name.
  const relevantPackages = useMemo(
    () =>
      client
        ? packages.filter(
            (p) =>
              !p.dog_name || p.dog_name.trim().toLowerCase() === client.dog_name.trim().toLowerCase()
          )
        : [],
    [packages, client]
  );

  // One line per visit: a drop-off paired with the pick-up that followed.
  const visits = useMemo(() => {
    const ascending = [...signins].sort(
      (a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime()
    );
    const rows: {
      key: string;
      date: string;
      service: string;
      dropOff?: string;
      pickUp?: string;
      addons: string[];
      pickupWindow?: string | null;
      price?: number | null;
    }[] = [];
    let open: SignInRecord | null = null;
    for (const r of ascending) {
      if (r.action === "drop_off") {
        if (open) rows.push(toRow(open, null));
        open = r;
      } else {
        rows.push(toRow(open, r));
        open = null;
      }
    }
    if (open) rows.push(toRow(open, null));
    return rows.reverse();

    function toRow(drop: SignInRecord | null, pick: SignInRecord | null) {
      const anchor = drop ?? pick!;
      return {
        key: `${anchor.id}-${pick?.id ?? "open"}`,
        date: (anchor.created_at ?? "").slice(0, 10),
        service: drop?.service_type ?? pick?.service_type ?? "—",
        dropOff: drop?.created_at,
        pickUp: pick?.created_at,
        addons: drop?.addons ?? [],
        pickupWindow: drop?.pickup_window,
        price: pick?.price ?? null,
      };
    }
  }, [signins]);

  // Walks from both sources: daycare walks live on the sign-in row, boarding
  // walks in walk_logs keyed by stay + day + slot.
  const walkRows: WalkRow[] = useMemo(() => {
    const rows: WalkRow[] = [];
    for (const s of signins) {
      if (s.action !== "drop_off") continue;
      if (!s.walk_out && !s.walk_in && !s.walk_staff_initials) continue;
      rows.push({
        key: `signin-${s.id}`,
        date: (s.created_at ?? "").slice(0, 10),
        service: "Daycare",
        slot: "Walk",
        out: s.walk_out ?? "",
        back: s.walk_in ?? "",
        initials: s.walk_staff_initials ?? "",
      });
    }
    for (const w of walkLogs) {
      if (!w.walk_out && !w.walk_in && !w.staff_initials) continue;
      rows.push({
        key: `walk-${w.id ?? `${w.boarding_id}-${w.date}-${w.walk_index}`}`,
        date: w.date,
        service: "Boarding",
        slot: `Walk ${w.walk_index + 1}`,
        out: w.walk_out ?? "",
        back: w.walk_in ?? "",
        initials: w.staff_initials ?? "",
      });
    }
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  }, [signins, walkLogs]);

  const upcomingStays = useMemo(() => {
    const today = todayKey();
    return boardings.filter((b) => b.end_date >= today);
  }, [boardings]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <StaffNav current="" />
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <StaffNav current="" />
        <p className="text-sm text-rose-500">{error || "No dog found for this profile."}</p>
      </div>
    );
  }

  const overall = overallVaccineStatus(vaccinations);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <StaffNav current="" />

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
        <div className="shrink-0 text-center">
          {client.photo_data ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={client.photo_data}
              alt={`${client.dog_name}'s photo`}
              className="h-24 w-24 rounded-2xl object-cover"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-slate-100 text-3xl text-slate-300">
              🐕
            </div>
          )}
          <label className="mt-1.5 block cursor-pointer text-[11px] font-medium text-accent-600 hover:text-accent-800">
            {client.photo_data ? "Change photo" : "+ Add photo"}
            <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
          </label>
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-semibold text-slate-900">{client.dog_name}</h1>
          <p className="text-sm text-slate-500">{client.last_name}
            <br /> {client.phone}
          </p>
          <Link href={ownerHref(client.phone)} className="text-sm text-accent-600 hover:underline">
             Parent/Guardian's profile
          </Link>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_CLASSES[overall]}`}>
              💉 {STATUS_LABELS[overall]}
            </span>
            {dogPackage && (
              <span className="rounded-full bg-accent-50 px-2.5 py-1 text-[11px] font-semibold text-accent-700">
                📦 {daysLeft(dogPackage)} of {dogPackage.total_days} days left
              </span>
            )}
            {upcomingStays.length > 0 && (
              <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700">
                🛏️ {upcomingStays.length} upcoming stay{upcomingStays.length === 1 ? "" : "s"}
              </span>
            )}
            {!hasWaiver(client) && (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                ⚠️ No waiver on file
              </span>
            )}
          </div>
        </div>
      </div>

      {error && <p className="mb-4 text-xs font-medium text-rose-500">{error}</p>}

      {/* Basic info */}
      <Section title="Basic info">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Dog name">
            <input
              value={form.dog_name}
              onChange={(e) => setForm({ ...form, dog_name: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Owner last name">
            <input
              value={form.last_name}
              onChange={(e) => setForm({ ...form, last_name: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Usual drop-off / pick-up">
            <input
              value={form.drop_off_by}
              onChange={(e) => setForm({ ...form, drop_off_by: e.target.value })}
              className={inputClass}
            />
          </Field>

          <Field label="Breed">
            <input
              value={form.breed}
              onChange={(e) => setForm({ ...form, breed: e.target.value })}
              placeholder="Mixed Breed"
              className={inputClass}
            />
          </Field>
          <Field label="Sex">
            <select
              value={form.sex}
              onChange={(e) => setForm({ ...form, sex: e.target.value as DogSex | "" })}
              className={inputClass}
            >
              <option value="">Not recorded</option>
              {DOG_SEXES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Spayed / neutered">
            <select
              value={form.fixed_status}
              onChange={(e) =>
                setForm({ ...form, fixed_status: e.target.value as FixedStatus | "" })
              }
              className={inputClass}
            >
              <option value="">Not recorded</option>
              {FIXED_STATUSES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Date of birth">
            <input
              type="date"
              value={form.birthdate}
              onChange={(e) => setForm({ ...form, birthdate: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Weight (lb)">
            <input
              type="number"
              min="0"
              step="0.1"
              value={form.weight_lb}
              onChange={(e) => setForm({ ...form, weight_lb: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Vet">
            <input
              value={form.vet}
              onChange={(e) => setForm({ ...form, vet: e.target.value })}
              className={inputClass}
            />
          </Field>

          <div className="sm:col-span-3">
            <Field label="Also authorized to pick up">
              <input
                value={form.authorized_pickup}
                onChange={(e) => setForm({ ...form, authorized_pickup: e.target.value })}
                placeholder="Anyone else allowed to collect this dog"
                className={inputClass}
              />
            </Field>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={saveInfo}
            disabled={savingInfo}
            className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow-card hover:bg-accent-600 disabled:opacity-60"
          >
            {savingInfo ? "Saving…" : "Save changes"}
          </button>
          {infoSaved && <span className="text-xs font-medium text-emerald-600">Saved ✓</span>}
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Phone number is the owner&apos;s — change it on the{" "}
          <Link href={ownerHref(client.phone)} className="text-accent-600 hover:underline">
            owner profile
          </Link>
          .
        </p>
      </Section>

      {/* Vaccines */}
      <Section title="Vaccines">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3">Vaccine</th>
                <th className="py-2 pr-3">Date given</th>
                <th className="py-2 pr-3">Expires</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {VACCINES.map((v) => {
                const record = vaccinations.find((r) => r.vaccine === v.key);
                const status = vaccineStatus(record);
                return (
                  <tr key={v.key} className="border-b border-slate-50 last:border-0">
                    <td className="py-2 pr-3 font-medium text-slate-700">{v.label}</td>
                    <td className="py-2 pr-3">
                      <input
                        type="date"
                        value={record?.given_on ?? ""}
                        onChange={(e) => saveVaccine(v.key, { given_on: e.target.value })}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-accent-500"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="date"
                        value={record?.expires_on ?? ""}
                        onChange={(e) => saveVaccine(v.key, { expires_on: e.target.value })}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-accent-500"
                      />
                    </td>
                    <td className="py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_CLASSES[status]}`}
                      >
                        {STATUS_LABELS[status]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Packages */}
      <Section title="Packages" count={relevantPackages.length}>
        <ScrollBox>
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3">Bought</th>
                <th className="py-2 pr-3">For</th>
                <th className="py-2 pr-3">Days</th>
                <th className="py-2">Left</th>
              </tr>
            </thead>
            <tbody>
              {relevantPackages.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 pr-3 text-slate-600">{(p.created_at ?? "").slice(0, 10) || "—"}</td>
                  <td className="py-2 pr-3 text-slate-600">
                    {p.dog_name ? p.dog_name : <span className="text-slate-400">Shared</span>}
                  </td>
                  <td className="py-2 pr-3 text-slate-600">{p.total_days}</td>
                  <td className="py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        daysLeft(p) > 0 ? "bg-accent-50 text-accent-700" : "bg-rose-50 text-rose-600"
                      }`}
                    >
                      {daysLeft(p)} of {p.total_days}
                    </span>
                  </td>
                </tr>
              ))}
              {relevantPackages.length === 0 && <EmptyRow colSpan={4}>No packages on file.</EmptyRow>}
            </tbody>
          </table>
        </ScrollBox>
      </Section>

      {/* Stays */}
      <Section title="Boarding stays" count={boardings.length}>
        <ScrollBox>
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3">Dates</th>
                <th className="py-2 pr-3">Nights</th>
                <th className="py-2 pr-3">Add-ons</th>
                <th className="py-2">Report</th>
              </tr>
            </thead>
            <tbody>
              {boardings.map((b) => (
                <tr key={b.id} className="border-b border-slate-50 last:border-0">
                  <td className="whitespace-nowrap py-2 pr-3 text-slate-700">
                    {prettyDateKey(b.start_date)} → {prettyDateKey(b.end_date)}
                  </td>
                  <td className="py-2 pr-3 text-slate-600">
                    {Math.max(1, dateRange(b.start_date, b.end_date).length - 1)}
                  </td>
                  <td className="py-2 pr-3 text-slate-600">
                    {(b.addons ?? []).length ? (b.addons ?? []).join(", ") : "—"}
                  </td>
                  <td className="py-2">
                    <Link
                      href={`/report?boardingId=${b.id}`}
                      className="text-xs font-medium text-accent-600 hover:underline"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
              {boardings.length === 0 && <EmptyRow colSpan={4}>No boarding stays on file.</EmptyRow>}
            </tbody>
          </table>
        </ScrollBox>
      </Section>

      {/* Visits */}
      <Section title="Visits" count={visits.length}>
        <ScrollBox>
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Service</th>
                <th className="py-2 pr-3">In</th>
                <th className="py-2 pr-3">Out</th>
                <th className="py-2 pr-3">Add-ons</th>
                <th className="py-2">Price</th>
              </tr>
            </thead>
            <tbody>
              {visits.map((v) => (
                <tr key={v.key} className="border-b border-slate-50 last:border-0">
                  <td className="whitespace-nowrap py-2 pr-3 text-slate-700">{v.date}</td>
                  <td className="py-2 pr-3 capitalize text-slate-600">
                    {String(v.service).replace("_", " ")}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-slate-600">{timeOnly(v.dropOff)}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-slate-600">{timeOnly(v.pickUp)}</td>
                  <td className="py-2 pr-3 text-slate-600">
                    {v.addons.length ? v.addons.join(", ") : "—"}
                    {v.pickupWindow && (
                      <span className="ml-1 text-[10px] text-slate-400">({v.pickupWindow})</span>
                    )}
                  </td>
                  <td className="py-2 font-medium text-emerald-700">
                    {v.price != null ? `$${v.price.toFixed(2)}` : "—"}
                  </td>
                </tr>
              ))}
              {visits.length === 0 && <EmptyRow colSpan={6}>No visits on file.</EmptyRow>}
            </tbody>
          </table>
        </ScrollBox>
      </Section>

      {/* Walks */}
      <Section title="Walks" count={walkRows.length}>
        <ScrollBox>
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Service</th>
                <th className="py-2 pr-3">Slot</th>
                <th className="py-2 pr-3">Out</th>
                <th className="py-2 pr-3">Back</th>
                <th className="py-2">By</th>
              </tr>
            </thead>
            <tbody>
              {walkRows.map((w) => (
                <tr key={w.key} className="border-b border-slate-50 last:border-0">
                  <td className="whitespace-nowrap py-2 pr-3 text-slate-700">{w.date}</td>
                  <td className="py-2 pr-3 text-slate-600">{w.service}</td>
                  <td className="py-2 pr-3 text-slate-600">{w.slot}</td>
                  <td className="py-2 pr-3 text-slate-600">{w.out || "—"}</td>
                  <td className="py-2 pr-3 text-slate-600">{w.back || "—"}</td>
                  <td className="py-2 text-slate-600">{w.initials || "—"}</td>
                </tr>
              ))}
              {walkRows.length === 0 && <EmptyRow colSpan={6}>No walks logged yet.</EmptyRow>}
            </tbody>
          </table>
        </ScrollBox>
      </Section>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100";

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title}
        {count != null && <span className="ml-1.5 font-normal text-slate-300">({count})</span>}
      </h2>
      {children}
    </section>
  );
}

// History tables can run long — capping them keeps the profile scannable
// instead of pushing everything below the fold.
function ScrollBox({ children }: { children: React.ReactNode }) {
  return <div className="max-h-64 overflow-y-auto overflow-x-auto">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] text-slate-400">{label}</label>
      {children}
    </div>
  );
}

function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-5 text-center text-sm text-slate-400">
        {children}
      </td>
    </tr>
  );
}

function timeOnly(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
