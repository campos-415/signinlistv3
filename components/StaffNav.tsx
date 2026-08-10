"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import { loadPendingCount } from "@/lib/enrollment";
import { loadPendingBoardingCount } from "@/lib/boardingRequest";
import { showDesktopAlert } from "@/lib/notify";
import { displayName, signOut } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

// Dog and owner profiles are deliberately absent — they're reached by
// clicking a dog's name anywhere in the app, not from the nav.
const LINKS: { href: string; label: string }[] = [
  { href: "/dashboard", label: "🏠 Dashboard" },
  { href: "/in-house", label: "📋 In House" },
  { href: "/calendar", label: "🗓️ Calendar" },
  { href: "/packages", label: "📦 Packages" },
  { href: "/requests", label: "📥 Requests" },
  { href: "/day-report", label: "📊 Day report" },
  { href: "/settings", label: "⚙️ Settings" },
];

// How often to re-check for new requests. A minute is frequent enough that
// the front desk hears about a booking while the client is still on the
// website, and cheap enough to run on every staff page — it's two COUNT
// queries with no rows returned.
const POLL_MS = 60_000;

export default function StaffNav({ current }: { current: string }) {
  // Requests arrive from the website with nobody watching for them, so the
  // count rides along on every staff page — otherwise a submission sits
  // unseen until someone thinks to check.
  const [counts, setCounts] = useState({ enrollments: 0, boarding: 0 });
  const [toast, setToast] = useState("");
  // Previous totals, so a rise can be told from a first load. Starts null
  // so the very first poll never announces the backlog as "new".
  const seen = useRef<{ enrollments: number; boarding: number } | null>(null);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    getSupabase().auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  const poll = useCallback(async () => {
    const [enrollments, boarding] = await Promise.all([
      loadPendingCount(),
      loadPendingBoardingCount(),
    ]);
    setCounts({ enrollments, boarding });

    const before = seen.current;
    seen.current = { enrollments, boarding };
    if (!before) return;

    const newEnrollments = Math.max(0, enrollments - before.enrollments);
    const newBoardings = Math.max(0, boarding - before.boarding);
    if (!newEnrollments && !newBoardings) return;

    const parts = [
      newEnrollments ? `${newEnrollments} new client form${newEnrollments === 1 ? "" : "s"}` : "",
      newBoardings ? `${newBoardings} boarding request${newBoardings === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    const message = parts.join(" and ");
    setToast(message);
    showDesktopAlert("New request", message);
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    // Coming back to the tab is the other moment staff want a fresh number,
    // and it costs nothing when the page has been sitting in the background.
    const onVisible = () => document.visibilityState === "visible" && poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  const pending = counts.enrollments + counts.boarding;

  return (
    <>
      {/* Two rows, because they are two different things: who is signed in
          and where this device goes, above; where this session goes, below.
          Sharing one wrapping row meant the account controls changed place
          depending on how many page links happened to fit. */}
      <div className="mb-3 flex items-center justify-end gap-2 print:hidden">
        {user && (
          <span
            className="mr-auto hidden text-[11px] text-ink-3 sm:inline"
            title={user.email ?? undefined}
          >
            Signed in as <span className="font-medium text-ink-2">{displayName(user)}</span>
          </span>
        )}
        <button
          onClick={async () => {
            await signOut();
            window.location.href = "/";
          }}
          className="rounded-xl border border-line bg-surface px-3 py-2 text-xs font-medium text-ink-3 transition hover:border-rose-300 hover:text-rose-500"
          title="Sign out of this device"
        >
          ⏻ Sign out
        </button>
        <ThemeToggle />
        <Link
          href="/kiosk"
          className="rounded-xl border border-line bg-surface px-3.5 py-2 text-xs font-medium text-ink-3 hover:border-line"
        >
          ← Kiosk
        </Link>
      </div>

      <nav className="mb-6 flex flex-wrap items-center gap-2 print:hidden">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            // The border stays on both states, transparent when active.
            // Without it the current link was 2px narrower than the others
            // and every link after it jumped sideways on navigation.
            className={`relative rounded-xl border px-3.5 py-2 text-xs font-medium transition ${
              l.href === current
                ? "border-transparent bg-accent-500 text-accent-ink shadow-card"
                : "border-line bg-surface text-ink-2 hover:border-line"
            }`}
          >
            {l.label}
            {/* Taken out of the layout entirely. The count arrives from the
                network a moment after the page paints, and an inline badge
                widened this link on arrival, shoving every link after it
                sideways — the jump that made the bar look broken. */}
            {l.href === "/requests" && pending > 0 && (
              <span className="absolute -right-1.5 -top-1.5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow-card">
                {pending}
              </span>
            )}
          </Link>
        ))}
      </nav>

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-xs rounded-2xl border border-accent-200 bg-surface p-4 shadow-lg print:hidden">
          <p className="text-sm font-medium text-ink">📥 {toast}</p>
          <div className="mt-2 flex items-center gap-3">
            <Link
              href="/requests"
              onClick={() => setToast("")}
              className="rounded-xl bg-accent-500 px-3 py-1.5 text-xs font-medium text-accent-ink hover:bg-accent-600"
            >
              Review now
            </Link>
            <button
              onClick={() => setToast("")}
              className="text-xs font-medium text-ink-3 hover:text-ink-2"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  );
}
