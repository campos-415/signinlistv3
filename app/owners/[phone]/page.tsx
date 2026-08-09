"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { daysLeft, dogHref, hasWaiver } from "@/lib/clients";
import { prettyDateKey, todayKey } from "@/lib/dates";
import { Boarding, Client, Owner, Package } from "@/types";
import StaffGate from "@/components/StaffGate";
import StaffNav from "@/components/StaffNav";

export default function OwnerProfilePage() {
  return (
    <StaffGate title="Owner profile">
      <OwnerProfile />
    </StaffGate>
  );
}

const EMPTY_OWNER = {
  owner_name: "",
  email: "",
  address: "",
  emergency_name: "",
  emergency_phone: "",
  emergency_relation: "",
  notes: "",
  city: "",
  state: "",
  zip: "",
};

const EMPTY_DOG = { dog_name: "", last_name: "", drop_off_by: "", waiver_on_file: false };

function OwnerProfile() {
  const params = useParams<{ phone: string }>();
  // The route segment carries the phone exactly as stored — older rows
  // aren't all formatted the same way, so it's encoded rather than
  // rebuilt from digits.
  const phone = params?.phone ? decodeURIComponent(params.phone) : "";

  const [owner, setOwner] = useState<Owner | null>(null);
  const [form, setForm] = useState(EMPTY_OWNER);
  const [dogs, setDogs] = useState<Client[]>([]);
  const [boardings, setBoardings] = useState<Boarding[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // Adding or editing a dog on this number. One draft is enough — only one
  // card is ever open at a time.
  const [addingDog, setAddingDog] = useState(false);
  const [editingDogId, setEditingDogId] = useState<string | null>(null);
  const [dogForm, setDogForm] = useState(EMPTY_DOG);
  const [savingDog, setSavingDog] = useState(false);
  const [deletingDogId, setDeletingDogId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!phone) return;
    setLoading(true);
    setError("");
    try {
      const supabase = getSupabase();
      const [ownerRes, dogRes, boardingRes, pkgRes] = await Promise.all([
        // maybeSingle: the owner row is created lazily on first save, so a
        // profile with no details yet is normal, not an error.
        supabase.from("owners").select("*").eq("phone", phone).maybeSingle(),
        supabase.from("clients").select("*").eq("phone", phone).order("created_at", { ascending: true }),
        supabase.from("boardings").select("*").eq("phone", phone).order("start_date", { ascending: false }),
        supabase.from("packages").select("*").eq("phone", phone).order("created_at", { ascending: false }),
      ]);
      if (ownerRes.error) throw ownerRes.error;
      if (dogRes.error) throw dogRes.error;
      if (boardingRes.error) throw boardingRes.error;
      if (pkgRes.error) throw pkgRes.error;

      const ownerRow = (ownerRes.data as Owner | null) ?? null;
      setOwner(ownerRow);
      if (ownerRow) {
        setForm({
          owner_name: ownerRow.owner_name ?? "",
          email: ownerRow.email ?? "",
          address: ownerRow.address ?? "",
          emergency_name: ownerRow.emergency_name ?? "",
          emergency_phone: ownerRow.emergency_phone ?? "",
          emergency_relation: ownerRow.emergency_relation ?? "",
          notes: ownerRow.notes ?? "",
          city: ownerRow.city ?? "",
          state: ownerRow.state ?? "",
          zip: ownerRow.zip ?? "",
        });
      }
      setDogs((dogRes.data as Client[]) ?? []);
      setBoardings((boardingRes.data as Boarding[]) ?? []);
      setPackages((pkgRes.data as Package[]) ?? []);
    } catch (e) {
      console.error("Loading owner profile failed:", e);
      setError("Could not load this owner's profile.");
    } finally {
      setLoading(false);
    }
  }, [phone]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveOwner() {
    setSaving(true);
    setError("");
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase
        .from("owners")
        .upsert({ phone, ...trimmed(form) }, { onConflict: "phone" });
      if (err) throw err;
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      load();
    } catch (e) {
      console.error("Saving owner failed:", e);
      setError("Could not save those details.");
    } finally {
      setSaving(false);
    }
  }

  async function addDog() {
    if (!dogForm.dog_name.trim()) {
      setError("Give the dog a name.");
      return;
    }
    setSavingDog(true);
    setError("");
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase.from("clients").insert({
        phone,
        dog_name: dogForm.dog_name.trim(),
        // Default the surname to whatever the household already uses.
        last_name: dogForm.last_name.trim() || dogs[0]?.last_name || "",
        drop_off_by: dogForm.drop_off_by.trim(),
        // No signature is captured here — the signup flow is what does
        // that. Staff tick the box when a waiver was signed elsewhere, and
        // the card flags the dog until one way or the other is true.
        signature_data: "",
        waiver_on_file: dogForm.waiver_on_file,
      });
      if (err) throw err;
      setDogForm(EMPTY_DOG);
      setAddingDog(false);
      load();
    } catch (e) {
      console.error("Adding dog failed:", e);
      setError("Could not add that dog.");
    } finally {
      setSavingDog(false);
    }
  }

  async function saveDog(dog: Client) {
    if (!dog.id || !dogForm.dog_name.trim()) {
      setError("Give the dog a name.");
      return;
    }
    const nextName = dogForm.dog_name.trim();
    const nextLast = dogForm.last_name.trim();
    setSavingDog(true);
    setError("");
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase
        .from("clients")
        .update({
          dog_name: nextName,
          last_name: nextLast,
          drop_off_by: dogForm.drop_off_by.trim(),
          waiver_on_file: dogForm.waiver_on_file,
        })
        .eq("id", dog.id);
      if (err) throw err;

      // Reservations and packages are matched to a dog by name, not by id,
      // so a rename has to carry across or the dog silently loses its
      // stays and package. Scoped to this phone number.
      if (nextName.toLowerCase() !== dog.dog_name.trim().toLowerCase()) {
        const [boardingErr, pkgErr] = await Promise.all([
          supabase
            .from("boardings")
            .update({ dog_name: nextName, last_name: nextLast })
            .eq("phone", phone)
            .ilike("dog_name", dog.dog_name)
            .then((r) => r.error),
          supabase
            .from("packages")
            .update({ dog_name: nextName })
            .eq("phone", phone)
            .ilike("dog_name", dog.dog_name)
            .then((r) => r.error),
        ]);
        if (boardingErr) throw boardingErr;
        if (pkgErr) throw pkgErr;
      }

      setEditingDogId(null);
      setDogForm(EMPTY_DOG);
      load();
    } catch (e) {
      console.error("Saving dog failed:", e);
      setError("Could not save that dog.");
    } finally {
      setSavingDog(false);
    }
  }

  async function deleteDog(dog: Client) {
    if (!dog.id) return;
    // Sign-ins and reservations reference the dog but aren't cascaded, so
    // say plainly what survives the delete before doing it.
    const stays = boardings.filter(
      (b) => b.dog_name.trim().toLowerCase() === dog.dog_name.trim().toLowerCase()
    ).length;
    const warning = stays
      ? `\n\n${dog.dog_name} has ${stays} boarding reservation${stays === 1 ? "" : "s"} on file. `
      : "\n\n";
    if (
      !window.confirm(
        `Delete ${dog.dog_name} from this number?${warning}Their profile, photo, and vaccine records are removed. Past sign-ins and reservations stay in the records for bookkeeping, but stop being linked to a profile. This can't be undone.`
      )
    ) {
      return;
    }
    setDeletingDogId(dog.id);
    setError("");
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase.from("clients").delete().eq("id", dog.id);
      if (err) throw err;
      load();
    } catch (e) {
      console.error("Deleting dog failed:", e);
      setError("Could not delete that dog.");
    } finally {
      setDeletingDogId(null);
    }
  }

  function startEditDog(dog: Client) {
    setAddingDog(false);
    setEditingDogId(dog.id ?? null);
    setDogForm({
      dog_name: dog.dog_name,
      last_name: dog.last_name,
      drop_off_by: dog.drop_off_by ?? "",
      waiver_on_file: !!dog.waiver_on_file,
    });
  }

  const upcoming = useMemo(() => {
    const today = todayKey();
    return boardings
      .filter((b) => b.end_date >= today)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
  }, [boardings]);

  // The surname on file for any of their dogs, as a display name fallback
  // when no owner name has been entered yet.
  const displayName = form.owner_name || dogs[0]?.last_name || "Owner";

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <StaffNav current="" />
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <StaffNav current="" />

      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold text-slate-900">
          {displayName}
        </h1>
        <p className="text-sm text-slate-500">{phone}</p>
        {!owner && (
          <p className="mt-1 text-xs text-amber-700">
            No contact details saved yet — fill in what you know and hit save.
          </p>
        )}
      </div>

      {error && (
        <p className="mb-4 text-xs font-medium text-rose-500">{error}</p>
      )}

      {/* Dogs */}
      <Section title="Dogs" count={dogs.length}>
        {dogs.length === 0 && !addingDog && (
          <p className="mb-3 text-sm text-slate-400">
            No dogs on file for this number.
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          {dogs.map((d) =>
            editingDogId === d.id ? (
              <div
                key={d.id}
                className="w-full rounded-2xl border border-accent-200 bg-accent-50/40 p-4">
                <p className="mb-2 text-xs font-medium text-slate-600">
                  Editing {d.dog_name}
                </p>
                <DogFields form={dogForm} setForm={setDogForm} />
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => saveDog(d)}
                    disabled={savingDog}
                    className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow-card hover:bg-accent-600 disabled:opacity-60">
                    {savingDog ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={() => {
                      setEditingDogId(null);
                      setDogForm(EMPTY_DOG);
                    }}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:border-slate-300">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={d.id}
                className="flex w-44 flex-col items-center gap-2 rounded-2xl border border-slate-200 p-3 text-center">
                <Link
                  href={d.id ? dogHref(d.id) : "#"}
                  className="flex flex-col items-center gap-2 transition hover:opacity-80">
                  {d.photo_data ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={d.photo_data}
                      alt={`${d.dog_name}'s photo`}
                      className="h-16 w-16 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-2xl">
                      🐕
                    </span>
                  )}
                  <span className="text-sm font-medium text-slate-800">
                    {d.dog_name}
                  </span>
                  <span className="text-[11px] text-accent-600">
                    Open profile →
                  </span>
                </Link>

                {/* Covered either by a signature from signup or by staff
                    confirming one signed elsewhere. */}
                {!hasWaiver(d) && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                    No waiver on file
                  </span>
                )}
                {!d.signature_data && d.waiver_on_file && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                    Waiver on file (paper)
                  </span>
                )}
                {d.signature_data && !d.waiver_on_file && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                    Waiver on file (digital)
                  </span>
                )}

                <div className="flex gap-1.5">
                  <button
                    onClick={() => startEditDog(d)}
                    className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:border-slate-300">
                    Edit
                  </button>
                  <button
                    onClick={() => deleteDog(d)}
                    disabled={deletingDogId === d.id}
                    className="rounded-lg border border-rose-200 px-2.5 py-1 text-[11px] text-rose-500 hover:border-rose-300 disabled:opacity-60">
                    {deletingDogId === d.id ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            ),
          )}
        </div>

        {addingDog ? (
          <div className="mt-3 rounded-2xl border border-accent-200 bg-accent-50/40 p-4">
            <p className="mb-2 text-xs font-medium text-slate-600">
              Add a dog to this number
            </p>
            <DogFields form={dogForm} setForm={setDogForm} />
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={addDog}
                disabled={savingDog}
                className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow-card hover:bg-accent-600 disabled:opacity-60">
                {savingDog ? "Adding…" : "Add dog"}
              </button>
              <button
                onClick={() => {
                  setAddingDog(false);
                  setDogForm(EMPTY_DOG);
                }}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:border-slate-300">
                Cancel
              </button>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              To capture an actual signature, send the client through{" "}
              <Link href="/signup" className="text-accent-600 hover:underline">
                signup
              </Link>{" "}
              instead.
            </p>
          </div>
        ) : (
          <button
            onClick={() => {
              setEditingDogId(null);
              setDogForm({ ...EMPTY_DOG, last_name: dogs[0]?.last_name ?? "" });
              setAddingDog(true);
            }}
            className="mt-3 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:border-accent-300">
            + Add a dog
          </button>
        )}
      </Section>

      {/* Contact */}
      <Section title="Contact">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Owner name">
            <input
              value={form.owner_name}
              onChange={(e) => setForm({ ...form, owner_name: e.target.value })}
              placeholder="First and last name"
              className={inputClass}
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="name@example.com"
              className={inputClass}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Street address">
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="1300 26th Ave"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="City">
            <input
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="State">
              <input
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
                maxLength={2}
                className={inputClass}
              />
            </Field>
            <Field label="ZIP">
              <input
                value={form.zip}
                onChange={(e) => setForm({ ...form, zip: e.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
        </div>
      </Section>

      {/* Emergency contact */}
      <Section title="Emergency contact">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name">
            <input
              value={form.emergency_name}
              onChange={(e) =>
                setForm({ ...form, emergency_name: e.target.value })
              }
              className={inputClass}
            />
          </Field>
          <Field label="Phone">
            <input
              value={form.emergency_phone}
              onChange={(e) =>
                setForm({ ...form, emergency_phone: e.target.value })
              }
              inputMode="numeric"
              className={inputClass}
            />
          </Field>
          <Field label="Relationship">
            <input
              value={form.emergency_relation}
              onChange={(e) =>
                setForm({ ...form, emergency_relation: e.target.value })
              }
              placeholder="Sister, neighbour…"
              className={inputClass}
            />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              placeholder="Anything staff should know about this client"
              className={inputClass}
            />
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={saveOwner}
            disabled={saving}
            className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow-card hover:bg-accent-600 disabled:opacity-60">
            {saving ? "Saving…" : "Save details"}
          </button>
          {saved && (
            <span className="text-xs font-medium text-emerald-600">
              Saved ✓
            </span>
          )}
        </div>
      </Section>

      {/* Upcoming reservations */}
      <Section title="Upcoming reservations" count={upcoming.length}>
        {upcoming.length === 0 ? (
          <p className="text-sm text-slate-400">
            No upcoming stays for any of their dogs.
          </p>
        ) : (
          <ul className="space-y-2">
            {upcoming.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3.5 py-2.5 text-sm">
                <span className="font-medium text-slate-800">
                  🛏️ {b.dog_name}
                </span>
                <span className="text-slate-600">
                  {prettyDateKey(b.start_date)} → {prettyDateKey(b.end_date)}
                </span>
                <Link
                  href={`/report?boardingId=${b.id}`}
                  className="text-xs font-medium text-accent-600 hover:underline">
                  Stay report →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Packages */}
      <Section title="Packages" count={packages.length}>
        {packages.length === 0 ? (
          <p className="text-sm text-slate-400">No packages on this number.</p>
        ) : (
          <ul className="space-y-2">
            {packages.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3.5 py-2.5 text-sm">
                <span className="text-slate-700">
                  📦{" "}
                  {p.dog_name || (
                    <span className="text-slate-400">Shared across dogs</span>
                  )}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                    daysLeft(p) > 0
                      ? "bg-accent-50 text-accent-700"
                      : "bg-rose-50 text-rose-600"
                  }`}>
                  {daysLeft(p)} of {p.total_days} left
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100";

function trimmed(form: typeof EMPTY_OWNER) {
  return Object.fromEntries(
    Object.entries(form).map(([k, v]) => [k, v.trim() || null])
  ) as Record<string, string | null>;
}

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] text-slate-400">{label}</label>
      {children}
    </div>
  );
}

// The same three fields whether staff are adding a dog or editing one.
// Photo and vaccines live on the dog's own profile, not here.
function DogFields({
  form,
  setForm,
}: {
  form: typeof EMPTY_DOG;
  setForm: (f: typeof EMPTY_DOG) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Dog name">
        <input
          value={form.dog_name}
          onChange={(e) => setForm({ ...form, dog_name: e.target.value })}
          placeholder="Bella"
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
          placeholder="Parent/guardian"
          className={inputClass}
        />
      </Field>
      <label className="flex items-start gap-2 sm:col-span-3">
        <input
          type="checkbox"
          checked={form.waiver_on_file}
          onChange={(e) => setForm({ ...form, waiver_on_file: e.target.checked })}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-accent-500 focus:ring-accent-100"
        />
        <span className="text-xs text-slate-600">
          Waiver signed and on file
          <span className="block text-[11px] text-slate-400">
            Tick this only if the client has actually signed — on paper or at another location. It
            clears the &ldquo;no waiver&rdquo; flag without capturing a signature.
          </span>
        </span>
      </label>
    </div>
  );
}
