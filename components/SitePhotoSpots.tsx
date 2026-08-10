"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  DEFAULT_TEAM,
  PLACEHOLDER_ABOUT,
  PLACEHOLDER_HERO,
  SitePhoto,
  loadSinglePhoto,
  loadSitePhotos,
} from "@/lib/sitePhotos";

// The single-photo spots and the team grid, filled from /settings.
//
// Each falls back to what the site shipped with, so a business that has not
// uploaded anything still has a finished-looking page rather than gaps.

function Picture({ src, alt, priority }: { src: string; alt: string; priority?: boolean }) {
  // Uploaded photos are data URLs, which next/image cannot optimise.
  return src.startsWith("data:") ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className="h-full w-full object-cover" />
  ) : (
    <Image
      src={src}
      alt={alt}
      fill
      sizes="(min-width: 768px) 560px, 100vw"
      className="object-cover"
      priority={priority}
    />
  );
}

export function HeroPhoto({
  kind,
  fallbackAlt,
  priority,
}: {
  kind: "hero" | "about";
  fallbackAlt: string;
  priority?: boolean;
}) {
  const [photo, setPhoto] = useState<SitePhoto | null | undefined>(undefined);

  useEffect(() => {
    loadSinglePhoto(kind).then(setPhoto);
  }, [kind]);

  const stock = kind === "hero" ? PLACEHOLDER_HERO : PLACEHOLDER_ABOUT;
  const src = photo?.data ?? stock;
  const alt = photo?.alt || fallbackAlt;

  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-3xl shadow-card">
      <Picture src={src} alt={alt} priority={priority} />
    </div>
  );
}

export function TeamGrid() {
  const [rows, setRows] = useState<SitePhoto[] | null>(null);

  useEffect(() => {
    loadSitePhotos("team").then(setRows);
  }, []);

  const team =
    rows && rows.length
      ? rows.map((r) => ({
          name: r.meta?.name ?? "",
          role: r.meta?.role ?? "",
          bio: r.meta?.bio ?? "",
          data: r.data,
        }))
      : DEFAULT_TEAM;

  return (
    <div className="grid gap-6 sm:grid-cols-3">
      {team.map((m, i) => (
        <div
          key={`${m.name}-${i}`}
          className="rounded-3xl border border-slate-100 bg-white p-6 text-center shadow-card"
        >
          <div className="relative mx-auto h-28 w-28 overflow-hidden rounded-full">
            <Picture src={m.data} alt={`${m.name}, ${m.role}`} />
          </div>
          <h3 className="mt-4 font-display text-lg font-semibold text-slate-900">{m.name}</h3>
          <p className="text-sm font-medium text-accent-600">{m.role}</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{m.bio}</p>
        </div>
      ))}
    </div>
  );
}
