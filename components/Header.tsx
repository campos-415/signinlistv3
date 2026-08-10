"use client";

import Link from "next/link";
import { useState } from "react";
import Image from "next/image";
import { NAV_LINKS } from "@/lib/business";
import { useBusiness } from "@/components/useBusiness";
import lombardlogo from "../public/lombardlogo.avif"

export default function Header() {
  const BUSINESS = useBusiness();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-slate-100 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2.5"
          onClick={() => setOpen(false)}>
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
          {/* <span className="font-display text-lg font-semibold tracking-tight text-slate-900">
            {BUSINESS.shortName}
          </span> */}
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-full px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-accent-600">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <a
            href={BUSINESS.phoneHref}
            className="text-sm font-medium text-slate-600 hover:text-accent-600">
            {BUSINESS.phone}
          </a>
          <Link
            href="/enroll"
            className="rounded-full bg-accent-500 px-5 py-2.5 text-sm font-semibold text-accent-ink shadow-card transition hover:bg-accent-600">
            Enroll Now
          </Link>
        </div>

        <button
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 lg:hidden"
          aria-label="Toggle menu"
          aria-expanded={open}>
          {open ? "✕" : "☰"}
        </button>
      </div>

      {open && (
        <nav className="border-t border-slate-100 bg-white px-5 py-3 lg:hidden">
          <ul className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  {link.label}
                </Link>
              </li>
            ))}
            <li className="mt-2 flex items-center gap-3 px-3">
              <a
                href={BUSINESS.phoneHref}
                className="text-sm font-medium text-slate-600">
                {BUSINESS.phone}
              </a>
            </li>
            <li className="px-3 pt-2">
              <Link
                href="/enroll"
                onClick={() => setOpen(false)}
                className="block rounded-full bg-accent-500 px-5 py-2.5 text-center text-sm font-semibold text-accent-ink shadow-card">
                Enroll Now
              </Link>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}
