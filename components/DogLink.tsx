"use client";

import Link from "next/link";
import { useState } from "react";
import { dogHref } from "@/lib/clients";
import { STATUS_CLASSES, STATUS_LABELS, VaccineStatus } from "@/lib/vaccines";
import { prettyDateKey } from "@/lib/dates";
import { Client } from "@/types";

export interface DogLinkBadges {
  packageDaysLeft?: number | null;
  nextStay?: { start_date: string; end_date: string } | null;
  vaccineStatus?: VaccineStatus | null;
}

// A dog's name, rendered as a link into its profile with an on-hover
// summary card. Everything it shows is passed in — the pages using it
// already load clients/packages/boardings, so this issues no queries and
// stays cheap to drop into a table cell.
export default function DogLink({
  client,
  name,
  badges,
  className = "",
}: {
  client: Client | null;
  // Falls back to a plain name when the dog has no client profile on file
  // (older sign-ins written before signup existed).
  name: string;
  badges?: DogLinkBadges;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!client?.id) {
    return <span className={className}>{name}</span>;
  }

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <Link
        href={dogHref(client.id)}
        className={`underline decoration-dotted underline-offset-2 hover:text-accent-600 ${className}`}
      >
        {name}
      </Link>

      {open && (
        <span className="absolute left-0 top-full z-30 mt-1 block w-64 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-lg print:hidden">
          <span className="flex items-start gap-3">
            {client.photo_data ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={client.photo_data}
                alt=""
                className="h-12 w-12 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg">
                🐕
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-slate-800">{client.dog_name}</span>
              <span className="block text-xs text-slate-500">{client.last_name}</span>
              <span className="block text-xs text-slate-400">{client.phone}</span>
            </span>
          </span>

          <span className="mt-2 flex flex-wrap gap-1.5">
            {badges?.vaccineStatus && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_CLASSES[badges.vaccineStatus]}`}
              >
                💉 {STATUS_LABELS[badges.vaccineStatus]}
              </span>
            )}
            {badges?.packageDaysLeft != null && (
              <span className="rounded-full bg-accent-50 px-2 py-0.5 text-[10px] font-semibold text-accent-700">
                📦 {badges.packageDaysLeft} left
              </span>
            )}
          </span>

          {badges?.nextStay && (
            <span className="mt-1.5 block text-[10px] text-slate-500">
              🛏️ {prettyDateKey(badges.nextStay.start_date)} → {prettyDateKey(badges.nextStay.end_date)}
            </span>
          )}

          <span className="mt-2 block text-[10px] font-medium text-accent-600">
            Click to open profile →
          </span>
        </span>
      )}
    </span>
  );
}
