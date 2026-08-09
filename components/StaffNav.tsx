"use client";

import Link from "next/link";

const LINKS: { href: string; label: string }[] = [
  { href: "/records", label: "📋 Records" },
  { href: "/boardings", label: "🛏️ Boardings" },
  { href: "/report", label: "🐾 Dog report" },
  { href: "/packages", label: "📦 Packages" },
];

// Shown at the top of every staff page so records can act as the hub
// staff navigate the rest of the site from, instead of each page being a
// dead end only reachable by a bookmark.
export default function StaffNav({ current }: { current: string }) {
  return (
    <nav className="mb-6 flex flex-wrap items-center gap-2 print:hidden">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`rounded-xl px-3.5 py-2 text-xs font-medium transition ${
            l.href === current
              ? "bg-accent-500 text-white shadow-card"
              : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300"
          }`}
        >
          {l.label}
        </Link>
      ))}
      <Link
        href="/"
        className="ml-auto rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-400 hover:border-slate-300"
      >
        ← Kiosk
      </Link>
    </nav>
  );
}
