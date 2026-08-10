"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { signIn } from "@/lib/auth";
import { isStaffUnlocked, markStaffUnlocked } from "@/lib/staffAuth";

// The login every staff page sits behind.
//
// Two layers, doing different jobs:
//
//   Sign-in    — a real Supabase session. This is the security boundary:
//                without it the DATABASE refuses the request, not just the
//                UI. It replaces a passcode that was compared in the
//                browser against a NEXT_PUBLIC_ env var, and so shipped in
//                plain sight inside the JavaScript bundle.
//   Idle lock  — re-prompts after a spell with no staff page open, so an
//                unattended back-office screen does not stay open all
//                afternoon. Convenience; it does not end the session.
export default function StaffGate({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [checking, setChecking] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const { data } = await getSupabase().auth.getSession();
    const has = !!data.session;
    setSignedIn(has);
    setUnlocked(has && isStaffUnlocked());
    setChecking(false);
  }, []);

  useEffect(() => {
    refresh();
    // Signing out in one tab should lock the others.
    const { data: sub } = getSupabase().auth.onAuthStateChange(() => refresh());
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  async function submit() {
    setBusy(true);
    setError("");
    const result = await signIn(username, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not sign in.");
      return;
    }
    setPassword("");
    markStaffUnlocked();
    setSignedIn(true);
    setUnlocked(true);
  }

  if (checking) {
    return (
      <div className="mx-auto mt-28 max-w-xs px-5">
        <p className="text-sm text-ink-3">Checking…</p>
      </div>
    );
  }

  if (signedIn && unlocked) return <>{children}</>;

  return (
    <div className="mx-auto mt-28 flex max-w-xs flex-col gap-3 px-5">
      <h1 className="font-display text-xl font-semibold text-ink">{title}</h1>
      <p className="-mt-1 text-xs text-ink-3">
        {signedIn ? "Locked after a spell of inactivity — sign in again." : "Staff sign-in."}
      </p>

      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        autoComplete="current-password"
        onKeyDown={(e) => e.key === "Enter" && submit()}
        className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
      />
      <button
        onClick={submit}
        disabled={busy}
        className="rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-medium text-accent-ink shadow-card hover:bg-accent-600 disabled:opacity-60"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
      {error && <p className="text-xs font-medium text-rose-500">{error}</p>}
    </div>
  );
}
