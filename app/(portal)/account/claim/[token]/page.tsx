"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { useSettings } from "@/components/SettingsProvider";
import { claimInvite, forgetCachedHousehold } from "@/lib/customer";

// Setting up an account, from the link in the email.
//
// This is the ONLY way an account ever becomes attached to a household. It
// is reached by opening a link that was emailed to the address already on
// file, which is what makes holding the link proof of controlling that
// address. There is deliberately no version of this screen that takes a
// phone number: guessing a phone number is trivial, and a portal that hands
// over a household for a correct guess is precisely the isolation failure
// the requirements are about.
//
// The token is checked by claim_owner_invite in the database, not here. This
// screen only gets a session for the person and then hands the token over.
export default function ClaimPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ? decodeURIComponent(params.token) : "";
  const router = useRouter();
  const { settings } = useSettings();

  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState<"create" | "signin">("create");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmNeeded, setConfirmNeeded] = useState(false);

  // Already signed in — either they came back to the link, or they just set
  // a password and Supabase handed back a session. Either way the only thing
  // left is to hand the token over.
  const finish = useCallback(async () => {
    const result = await claimInvite(token);
    if (!result.ok) {
      setError(result.error ?? "That invitation could not be used.");
      setChecking(false);
      return false;
    }
    forgetCachedHousehold();
    router.replace("/account");
    return true;
  }, [token, router]);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data } = await getSupabase().auth.getSession();
      if (!live) return;
      if (data.session) {
        await finish();
        return;
      }
      setChecking(false);
    })();
    return () => {
      live = false;
    };
  }, [finish]);

  async function createAccount() {
    if (!email.trim() || password.length < 8) {
      setError("Enter your email address and choose a password of at least 8 characters.");
      return;
    }
    setBusy(true);
    setError("");
    const supabase = getSupabase();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
    });
    if (signUpError) {
      setBusy(false);
      setError(
        signUpError.message.toLowerCase().includes("already")
          ? "There is already an account for that address. Sign in below instead."
          : "We could not set that up. Check the address and try again."
      );
      return;
    }
    // With email confirmations switched on there is no session yet, so the
    // claim cannot run until they have clicked through. Saying so is better
    // than a spinner that never resolves.
    if (!data.session) {
      setBusy(false);
      setConfirmNeeded(true);
      return;
    }
    await finish();
    setBusy(false);
  }

  async function signIn() {
    if (!email.trim() || !password) {
      setError("Enter your email address and password.");
      return;
    }
    setBusy(true);
    setError("");
    const { error: signInError } = await getSupabase().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (signInError) {
      setBusy(false);
      setError("That email and password don't match.");
      return;
    }
    await finish();
    setBusy(false);
  }

  if (checking) {
    return (
      <div className="mx-auto mt-20 max-w-sm px-1">
        <p className="text-sm text-ink-3">Setting your account up…</p>
      </div>
    );
  }

  if (confirmNeeded) {
    return (
      <div className="mx-auto mt-16 max-w-sm px-1">
        <h1 className="font-display text-xl font-semibold text-ink">Almost there</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          We have sent a message to <strong>{email}</strong> to check the address is yours. Click
          the link in it, then come back to this page and your account will be ready.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-10 flex max-w-sm flex-col gap-3 px-1 sm:mt-16">
      <h1 className="font-display text-xl font-semibold text-ink">
        {mode === "create" ? "Set up your account" : "Sign in to finish"}
      </h1>
      <p className="-mt-1 text-xs text-ink-3">
        {mode === "create"
          ? `Choose a password and you will be able to see your dogs' records with ${settings.business.name}.`
          : "Sign in and we will link this invitation to your account."}
      </p>

      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email address"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={mode === "create" ? "Choose a password" : "Password"}
        autoComplete={mode === "create" ? "new-password" : "current-password"}
        onKeyDown={(e) => e.key === "Enter" && (mode === "create" ? createAccount() : signIn())}
        className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
      />
      {mode === "create" && (
        <p className="-mt-1 text-[11px] text-ink-3">At least 8 characters.</p>
      )}

      <button
        onClick={mode === "create" ? createAccount : signIn}
        disabled={busy}
        className="rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-medium text-accent-ink shadow-card transition hover:bg-accent-600 disabled:opacity-60"
      >
        {busy ? "Working…" : mode === "create" ? "Create my account" : "Sign in"}
      </button>
      {error && <p className="text-xs font-medium text-rose-500">{error}</p>}

      <button
        onClick={() => {
          setMode((m) => (m === "create" ? "signin" : "create"));
          setError("");
        }}
        className="text-left text-xs font-medium text-accent-600 hover:underline"
      >
        {mode === "create" ? "I already have an account" : "I need to set a password"}
      </button>

      <Link href="/" className="mt-1 text-xs font-medium text-ink-3 hover:text-ink-2">
        ← {settings.business.name}
      </Link>
    </div>
  );
}
