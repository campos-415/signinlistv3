"use client";

import { useEffect, useState } from "react";
import { isStaffUnlocked, markStaffUnlocked } from "@/lib/staffAuth";

const PASSCODE = process.env.NEXT_PUBLIC_RECORDS_PASSCODE;

// The passcode screen every staff page sits behind. The unlock is shared
// across pages and slides on use (see lib/staffAuth.ts), so navigating
// between staff pages doesn't re-prompt — it only locks again after the
// idle window passes.
export default function StaffGate({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [unlocked, setUnlocked] = useState(false);
  const [entered, setEntered] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (isStaffUnlocked()) setUnlocked(true);
  }, []);

  function checkPasscode() {
    if (entered === PASSCODE) {
      markStaffUnlocked();
      setUnlocked(true);
      setError("");
    } else {
      setError("Wrong passcode.");
    }
  }

  if (unlocked) return <>{children}</>;

  return (
    <div className="mx-auto mt-28 flex max-w-xs flex-col gap-3 px-5">
      <h1 className="font-display text-xl font-semibold text-slate-900">{title}</h1>
      <input
        type="password"
        value={entered}
        onChange={(e) => setEntered(e.target.value)}
        placeholder="Passcode"
        onKeyDown={(e) => e.key === "Enter" && checkPasscode()}
        className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
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
