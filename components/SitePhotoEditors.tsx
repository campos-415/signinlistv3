"use client";

import { ChangeEvent, useCallback, useEffect, useState } from "react";
import { fileToResizedDataUrl } from "@/lib/image";
import {
  DEFAULT_TEAM,
  PLACEHOLDER_ABOUT,
  PLACEHOLDER_HERO,
  SitePhoto,
  addSitePhoto,
  clearSinglePhoto,
  deleteSitePhoto,
  loadSinglePhoto,
  loadSitePhotos,
  reorderSitePhotos,
  setSinglePhoto,
  updateSitePhoto,
} from "@/lib/sitePhotos";

// Editors for the one-off photo spots and the team cards. Like the gallery
// editor, these save immediately — they are their own rows, not part of the
// settings blob the Save button writes.

export function SinglePhotoEditor({
  kind,
  label,
  hint,
}: {
  kind: "hero" | "about";
  label: string;
  hint: string;
}) {
  const [photo, setPhoto] = useState<SitePhoto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setPhoto(await loadSinglePhoto(kind));
    setLoading(false);
  }, [kind]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      // Wider than a gallery tile — this one runs half the screen.
      const data = await fileToResizedDataUrl(file, 1600, 0.82);
      await setSinglePhoto(kind, data, photo?.alt ?? "");
      await refresh();
    } catch (err) {
      console.error("Uploading photo failed:", err);
      setError("Could not save that image — try a smaller file.");
    } finally {
      setBusy(false);
    }
  }

  const src = photo?.data ?? (kind === "hero" ? PLACEHOLDER_HERO : PLACEHOLDER_ABOUT);

  return (
    <div className="rounded-xl border border-line-soft p-3.5">
      <p className="text-sm font-medium text-ink-2">{label}</p>
      <p className="mb-2 text-[11px] text-ink-3">{hint}</p>
      {loading ? (
        <p className="text-xs text-ink-3">Loading…</p>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className="aspect-[4/3] w-full max-w-xs rounded-xl object-cover" />
          {!photo && (
            <p className="mt-1.5 text-[11px] text-amber-700">Stock photo — upload one to replace it.</p>
          )}
          <input
            defaultValue={photo?.alt ?? ""}
            onBlur={(e) =>
              photo?.id && updateSitePhoto(photo.id, { alt: e.target.value.trim() || null })
            }
            placeholder="Describe this photo"
            disabled={!photo}
            className="mt-2 w-full max-w-xs rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent-500 disabled:opacity-50"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="cursor-pointer rounded-xl border border-line bg-surface px-3.5 py-2 text-xs font-medium text-ink-2 transition hover:border-accent-400">
              {busy ? "Uploading…" : photo ? "Replace" : "Upload"}
              <input type="file" accept="image/*" className="hidden" onChange={upload} disabled={busy} />
            </label>
            {photo && (
              <button
                onClick={async () => {
                  await clearSinglePhoto(kind);
                  refresh();
                }}
                className="text-[11px] text-rose-400 hover:text-rose-600"
              >
                Remove (back to stock)
              </button>
            )}
          </div>
        </>
      )}
      {error && <p className="mt-2 text-xs font-medium text-rose-500">{error}</p>}
    </div>
  );
}

export function TeamEditor() {
  const [rows, setRows] = useState<SitePhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setRows(await loadSitePhotos("team"));
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function add(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      // Rendered as a small round portrait, so it needs no more than this.
      const data = await fileToResizedDataUrl(file, 600, 0.85);
      await addSitePhoto(data, "", "team", { name: "", role: "", bio: "" });
      await refresh();
    } catch (err) {
      console.error("Adding team member failed:", err);
      setError("Could not save that photo.");
    } finally {
      setBusy(false);
    }
  }

  async function saveMeta(row: SitePhoto, patch: Record<string, string>) {
    if (!row.id) return;
    const meta = { ...(row.meta ?? {}), ...patch };
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, meta } : r)));
    try {
      await updateSitePhoto(row.id, { meta });
    } catch (err) {
      console.error("Saving team member failed:", err);
      setError("Could not save that change.");
    }
  }

  async function move(index: number, delta: number) {
    const next = [...rows];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setRows(next);
    await reorderSitePhotos(next.map((r) => r.id!).filter(Boolean));
  }

  const field =
    "w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent-500";

  return (
    <div>
      {rows.length === 0 && !loading && (
        <p className="mb-3 rounded-xl bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          Showing the three team members the site shipped with ({DEFAULT_TEAM.map((m) => m.name).join(", ")}).
          Add someone here and this list replaces them entirely — so add everyone you want shown.
        </p>
      )}
      {error && <p className="mb-3 text-xs font-medium text-rose-500">{error}</p>}

      {loading ? (
        <p className="text-sm text-ink-3">Loading…</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row, i) => (
            <div key={row.id} className="rounded-2xl border border-line-soft p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={row.data}
                alt=""
                className="mx-auto h-24 w-24 rounded-full object-cover"
              />
              <input
                defaultValue={row.meta?.name ?? ""}
                onBlur={(e) => saveMeta(row, { name: e.target.value })}
                placeholder="Name"
                className={`${field} mt-2`}
              />
              <input
                defaultValue={row.meta?.role ?? ""}
                onBlur={(e) => saveMeta(row, { role: e.target.value })}
                placeholder="Role"
                className={`${field} mt-1.5`}
              />
              <textarea
                defaultValue={row.meta?.bio ?? ""}
                onBlur={(e) => saveMeta(row, { bio: e.target.value })}
                placeholder="Short bio"
                rows={3}
                className={`${field} mt-1.5`}
              />
              <div className="mt-1.5 flex items-center gap-1">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="rounded-lg border border-line px-2 py-1 text-[11px] text-ink-2 disabled:opacity-30"
                >
                  ←
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === rows.length - 1}
                  className="rounded-lg border border-line px-2 py-1 text-[11px] text-ink-2 disabled:opacity-30"
                >
                  →
                </button>
                <button
                  onClick={async () => {
                    if (!row.id) return;
                    if (!window.confirm(`Remove ${row.meta?.name || "this person"} from the website?`)) return;
                    await deleteSitePhoto(row.id);
                    refresh();
                  }}
                  className="ml-auto text-[11px] text-rose-400 hover:text-rose-600"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <label className="mt-3 inline-block cursor-pointer rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink-2 transition hover:border-accent-400">
        {busy ? "Uploading…" : "+ Add team member"}
        <input type="file" accept="image/*" className="hidden" onChange={add} disabled={busy} />
      </label>
      <p className="mt-1.5 text-[11px] text-ink-3">
        Pick the portrait first, then fill in the name, role and bio. Each field saves when you
        click away from it.
      </p>
    </div>
  );
}
