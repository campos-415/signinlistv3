"use client";

import { useCallback, useEffect, useState } from "react";
import MfaSetup from "@/components/MfaSetup";
import { MfaFactor, assuranceLevel, verifiedFactor, verifyCode } from "@/lib/mfa";
import { logMfaVerified } from "@/lib/audit";
import { StaffAccount, ROLE_LABELS, mfaRequiredFor } from "@/lib/roles";

// The second factor, for the accounts the requirements document says need
// one: Owner/Admin and Manager.
//
// Three states, and which one appears depends on what the account has done
// so far rather than on a setting somebody has to remember to turn on:
//
//   Owed      an authenticator is set up and this session has not used it.
//             A code is required and there is no way past this screen. The
//             database agrees: at aal1 every manager and owner capability is
//             refused, so skipping it would produce an application where
//             nothing works rather than one with the locks off.
//   Missing   the account needs MFA and has not set it up. Setup is offered.
//             It can be deferred exactly while the database is still in its
//             grace window, and the "Not now" button disappears the moment
//             the account is marked as requiring it - which enrolment itself
//             does. Employee-level work keeps working meanwhile, so nobody
//             is stuck mid-shift.
//   Satisfied nothing to do, and this renders its children.
//
// Employees and the lobby kiosk never see any of this.

type Stage = "checking" | "challenge" | "enrol" | "satisfied";

export default function MfaGate({
  account,
  children,
}: {
  account: StaffAccount;
  children: React.ReactNode;
}) {
  const [stage, setStage] = useState<Stage>("checking");
  const [factor, setFactor] = useState<MfaFactor | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deferred, setDeferred] = useState(false);

  const assess = useCallback(async () => {
    if (!mfaRequiredFor(account.role)) {
      setStage("satisfied");
      return;
    }
    try {
      const [level, verified] = await Promise.all([assuranceLevel(), verifiedFactor()]);
      setFactor(verified);
      if (verified) {
        setStage(level.current === "aal2" ? "satisfied" : "challenge");
      } else {
        setStage("enrol");
      }
    } catch (e) {
      // Not a reason to lock somebody out of the app: the database is still
      // the boundary, and at aal1 it refuses manager work by itself.
      console.error("Could not check the MFA state:", e);
      setStage("satisfied");
    }
  }, [account.role]);

  useEffect(() => {
    assess();
  }, [assess]);

  async function submit() {
    if (!factor) return;
    setBusy(true);
    setError("");
    const result = await verifyCode(factor.id, code);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "That code was not accepted.");
      setCode("");
      return;
    }
    await logMfaVerified();
    setStage("satisfied");
  }

  if (stage === "checking") {
    return (
      <div className="mx-auto mt-28 max-w-xs px-5">
        <p className="text-sm text-ink-3">Checking…</p>
      </div>
    );
  }

  if (stage === "satisfied" || (stage === "enrol" && deferred)) {
    return <>{children}</>;
  }

  if (stage === "challenge") {
    return (
      <div className="mx-auto mt-28 flex max-w-xs flex-col gap-3 px-5">
        <h1 className="font-display text-xl font-semibold text-ink">Two-factor code</h1>
        <p className="-mt-1 text-xs leading-relaxed text-ink-3">
          {ROLE_LABELS[account.role ?? "manager"]} accounts need a code from the authenticator app
          as well as a password.
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          placeholder="123456"
          className="rounded-xl border border-line bg-surface px-4 py-2.5 text-center font-mono text-lg tracking-[0.3em] text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
        />
        <button
          onClick={submit}
          disabled={busy || code.length < 6}
          className="rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-medium text-accent-ink shadow-card hover:bg-accent-600 disabled:opacity-60"
        >
          {busy ? "Checking…" : "Continue"}
        </button>
        {error && <p className="text-xs font-medium text-rose-500">{error}</p>}
        <p className="text-[11px] leading-relaxed text-ink-3">
          Lost the phone with the app on it? An owner can lift the requirement for your account in
          Settings → Security, and you can set it up again on the new one.
        </p>
      </div>
    );
  }

  // stage === "enrol"
  return (
    <div className="mx-auto mt-20 max-w-xl px-5">
      <h1 className="font-display text-xl font-semibold text-ink">Set up two-factor sign-in</h1>
      <p className="mt-1 text-xs leading-relaxed text-ink-3">
        {ROLE_LABELS[account.role ?? "manager"]} accounts can read every client record and download
        the client list, so a password on its own is not enough. This takes about a minute and only
        has to be done once per person.
      </p>
      <div className="mt-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
        <MfaSetup
          onDone={assess}
          // Deferring is allowed exactly as long as the database allows it.
          // Once this account is marked as requiring MFA the option is gone,
          // and enrolling is what marks it.
          onCancel={account.requireMfa ? undefined : () => setDeferred(true)}
        />
      </div>
      {!account.requireMfa && (
        <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
          Choosing &ldquo;Not now&rdquo; keeps the day running — sign-ins, records and reservations
          all still work. What will not work until this is set up is the manager side: exports,
          deleting records and changing permissions. The database refuses those without a code, not
          just this screen.
        </p>
      )}
    </div>
  );
}
