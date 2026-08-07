"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import SignaturePad, { SignaturePadHandle } from "@/components/SignaturePad";
import { getSupabase } from "@/lib/supabase";
import { formatPhoneInput } from "@/lib/phone";
import Image from "next/image";
import lombardlogo from "@/public/lombardlogo.avif"

interface DogEntry {
  dogName: string;
  lastName: string;
}

export default function SignupPage() {
  const [dogs, setDogs] = useState<DogEntry[]>([{ dogName: "", lastName: "" }]);
  const [dropOffBy, setDropOffBy] = useState("");
  const [phone, setPhone] = useState("");
  const [sigError, setSigError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const sigRef = useRef<SignaturePadHandle>(null);

  function updateDog(index: number, field: keyof DogEntry, value: string) {
    setDogs((prev) => prev.map((d, i) => (i === index ? { ...d, [field]: value } : d)));
  }

  function addDog() {
    // New dogs default to the first dog's last name — same family, saves
    // re-typing, still editable per dog.
    setDogs((prev) => [...prev, { dogName: "", lastName: prev[0]?.lastName ?? "" }]);
  }

  function removeDog(index: number) {
    setDogs((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    setError("");
    const digits = phone.replace(/\D/g, "");
    const cleanedDogs = dogs.map((d) => ({ dogName: d.dogName.trim(), lastName: d.lastName.trim() }));
    if (cleanedDogs.some((d) => !d.dogName || !d.lastName) || digits.length < 7) {
      setError("Each dog needs a name and last name, plus a phone number.");
      return;
    }
    if (sigRef.current?.isEmpty()) {
      setSigError(true);
      return;
    }
    setSigError(false);
    setSubmitting(true);

    try {
      const supabase = getSupabase();
      const signature = sigRef.current?.toDataURL() ?? "";
      const rows = cleanedDogs.map((d) => ({
        phone: phone.trim(),
        dog_name: d.dogName,
        last_name: d.lastName,
        drop_off_by: dropOffBy.trim(),
        signature_data: signature,
      }));
      const { error: err } = await supabase.from("clients").insert(rows);
      if (err) throw err;
      setDone(true);
    } catch (e) {
      console.error("Signup save failed:", e);
      setError("Couldn't save — check the connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-accent-500 text-3xl text-white shadow-card">
          ✓
        </div>
        <p className="text-lg font-medium text-slate-800">
          You&apos;re all set, {dogs.map((d) => d.dogName.trim()).join(" & ")}!
        </p>
        <p className="max-w-xs text-sm text-slate-500">
          Next time, just enter your phone number on the sign-in screen — no need to fill this out again.
        </p>
        <Link
          href="/"
          className="mt-2 rounded-xl bg-accent-500 px-6 py-2.5 text-sm font-medium text-white shadow-card transition hover:bg-accent-600"
        >
          Go to sign-in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="mb-3 flex items-center gap-2.5">
          <span className="flex  items-center justify-center rounded-2xl  text-xl text-white shadow-card">
            <Image
              src={lombardlogo}
              alt={"Logo"}
              width={100}
              height={100}
              objectFit=""
              className="object-cover"
            />
          </span>
        </div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">
          New client signup
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          One-time — sign the waiver now, then check-in only takes a phone
          number
        </p>
      </div>

      <div className="rounded-3xl bg-white p-6 shadow-card sm:p-8">
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="block text-xs font-medium text-slate-500">
                  Dogs on this account
                </label>
                {dogs.length > 1 && (
                  <span className="text-xs text-slate-400">
                    {dogs.length} dog{dogs.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <div className="space-y-3">
                {dogs.map((dog, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center gap-2">
                      <input
                        value={dog.dogName}
                        onChange={(e) =>
                          updateDog(i, "dogName", e.target.value)
                        }
                        placeholder="Dog's name"
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
                      />
                      {dogs.length > 1 && (
                        <button
                          onClick={() => removeDog(i)}
                          className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-400 hover:border-rose-300 hover:text-rose-500"
                          title="Remove this dog">
                          ✕
                        </button>
                      )}
                    </div>
                    <input
                      value={dog.lastName}
                      onChange={(e) => updateDog(i, "lastName", e.target.value)}
                      placeholder="Owner's last name"
                      className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
                    />
                  </div>
                ))}
              </div>
              <button
                onClick={addDog}
                className="mt-2 w-full rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-500 transition hover:border-accent-400 hover:text-accent-600">
                + Add another dog
              </button>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">
                Usual drop-off person
              </label>
              <input
                value={dropOffBy}
                onChange={(e) => setDropOffBy(e.target.value)}
                placeholder="Parent/guardian"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-accent-500 focus:bg-white focus:ring-2 focus:ring-accent-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">
                Phone number
              </label>
              <input
                value={phone}
                onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                placeholder="(123) 456-7890"
                inputMode="numeric"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-accent-500 focus:bg-white focus:ring-2 focus:ring-accent-100"
              />
              <p className="mt-1.5 text-xs text-slate-400">
                This is what you&apos;ll enter at check-in — one number covers
                every dog listed above.
              </p>
            </div>
          </div>

          <div className="flex flex-col">
            <label className="mb-1.5 block text-xs font-medium text-slate-500">
              Waiver signature
            </label>
            <p className="mb-2 text-xs text-slate-400">
              By signing, you agree to the facility&apos;s daycare waiver and
              release of liability on file at the front desk, for every dog
              listed.
            </p>
            <SignaturePad ref={sigRef} />
            {sigError && (
              <p className="mt-1.5 text-xs font-medium text-rose-500">
                Signature is required.
              </p>
            )}
          </div>
        </div>

        {error && (
          <p className="mt-5 text-xs font-medium text-rose-500">{error}</p>
        )}

        <div className="mt-8 flex items-center gap-3">
          <button
            onClick={() => sigRef.current?.clear()}
            className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-600 transition hover:border-slate-300">
            Clear signature
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-xl bg-accent-500 px-6 py-2.5 text-sm font-medium text-white shadow-card transition hover:bg-accent-600 disabled:opacity-60">
            {submitting
              ? "Saving…"
              : dogs.length > 1
                ? `Complete signup (${dogs.length} dogs)`
                : "Complete signup"}
          </button>
          <Link
            href="/"
            className="ml-auto text-xs font-medium text-slate-400 hover:text-slate-600">
            Back to sign-in
          </Link>
        </div>
      </div>
    </div>
  );
}
