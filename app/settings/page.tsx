"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { fileToResizedDataUrl } from "@/lib/image";
import {
  AppSettings,
  CatalogItem,
  DEFAULT_SETTINGS,
  PackageTier,
  saveSettings,
} from "@/lib/settings";
import { useSettings } from "@/components/SettingsProvider";
import StaffGate from "@/components/StaffGate";
import StaffNav from "@/components/StaffNav";

export default function SettingsPage() {
  return (
    <StaffGate title="App settings">
      <Settings />
    </StaffGate>
  );
}

function Settings() {
  const { settings, refresh } = useSettings();
  // Edited as a local draft so a half-typed price never reaches the kiosk —
  // nothing takes effect until Save.
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  function patchPricing(patch: Partial<AppSettings["pricing"]>) {
    setDraft((d) => ({ ...d, pricing: { ...d.pricing, ...patch } }));
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await saveSettings(draft);
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      console.error("Saving settings failed:", e);
      setError("Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      // Bigger than a dog photo — this one is rendered large on the kiosk.
      const dataUrl = await fileToResizedDataUrl(file, 512, 0.9);
      setDraft((d) => ({ ...d, business: { ...d.business, logoData: dataUrl } }));
    } catch {
      setError("Could not read that image — try a different file.");
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <StaffNav current="/settings" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-slate-900">Settings</h1>
          <p className="text-sm text-slate-500">
            Prices and add-ons here drive every estimate, sign-out total, and report.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs font-medium text-emerald-600">Saved ✓</span>}
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-medium text-white shadow-card hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-xs font-medium text-rose-500">{error}</p>}
      {dirty && (
        <p className="mb-4 rounded-xl bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-800">
          Unsaved changes — nothing takes effect until you save.
        </p>
      )}

      {/* Branding */}
      <Section title="Business" blurb="Shown on the kiosk and at the top of printed reports.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Business name">
            <input
              value={draft.business.name}
              onChange={(e) =>
                setDraft({ ...draft, business: { ...draft.business, name: e.target.value } })
              }
              className={inputClass}
            />
          </Field>
          <Field label="Tagline">
            <input
              value={draft.business.tagline}
              onChange={(e) =>
                setDraft({ ...draft, business: { ...draft.business, tagline: e.target.value } })
              }
              className={inputClass}
            />
          </Field>
        </div>

        <div className="mt-3 flex items-center gap-3">
          {draft.business.logoData ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={draft.business.logoData}
              alt="Logo"
              className="h-16 w-16 rounded-xl object-contain"
            />
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-slate-100 text-2xl">
              🐾
            </span>
          )}
          <div>
            <label className="cursor-pointer text-xs font-medium text-accent-600 hover:text-accent-800">
              {draft.business.logoData ? "Change logo" : "+ Upload a logo"}
              <input type="file" accept="image/*" className="hidden" onChange={handleLogo} />
            </label>
            {draft.business.logoData && (
              <button
                onClick={() =>
                  setDraft({ ...draft, business: { ...draft.business, logoData: null } })
                }
                className="ml-3 text-xs text-slate-400 hover:text-slate-600"
              >
                Remove
              </button>
            )}
            <p className="mt-0.5 text-[11px] text-slate-400">
              Falls back to the bundled logo when empty.
            </p>
          </div>
        </div>
      </Section>

      {/* Daycare & boarding */}
      <Section title="Daycare & boarding rates">
        <div className="grid gap-3 sm:grid-cols-3">
          <Money
            label="Daycare — full day"
            value={draft.pricing.daycareFullDay}
            onChange={(v) => patchPricing({ daycareFullDay: v })}
          />
          <Money
            label="Daycare — half day"
            value={draft.pricing.daycareHalfDay}
            onChange={(v) => patchPricing({ daycareHalfDay: v })}
          />
          <Field label="Half-day cutoff (hours)">
            <input
              type="number"
              min={1}
              max={12}
              value={draft.pricing.daycareHalfDayThresholdHours}
              onChange={(e) =>
                patchPricing({ daycareHalfDayThresholdHours: Number(e.target.value) || 1 })
              }
              className={inputClass}
            />
          </Field>
          <Money
            label="Boarding — per night"
            value={draft.pricing.boardingPerNight}
            onChange={(v) => patchPricing({ boardingPerNight: v })}
          />
          <Money
            label="Late pick-up fee"
            value={draft.pricing.latePickupFee}
            onChange={(v) => patchPricing({ latePickupFee: v })}
          />
          <Field label="Late pick-up after (hour, 24h)">
            <input
              type="number"
              min={0}
              max={23}
              value={draft.pricing.latePickupHour}
              onChange={(e) => patchPricing({ latePickupHour: Number(e.target.value) || 0 })}
              className={inputClass}
            />
          </Field>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          A visit longer than the cutoff bills as a full day, and only a full day is covered by a
          package. The late fee is charged once, on the day a boarding dog actually goes home.
        </p>
      </Section>

      {/* Bath */}
      <Section title="Bath prices" blurb="Bath is priced by size rather than a flat rate.">
        <div className="grid gap-3 sm:grid-cols-3">
          {(["S", "M", "L"] as const).map((size) => (
            <Money
              key={size}
              label={`Bath — ${size === "S" ? "small" : size === "M" ? "medium" : "large"}`}
              value={draft.pricing.bath[size]}
              onChange={(v) => patchPricing({ bath: { ...draft.pricing.bath, [size]: v } })}
            />
          ))}
        </div>
      </Section>

      {/* Walk-in add-ons */}
      <Section
        title="Daycare add-ons"
        blurb="Offered at the kiosk on drop-off. Bath is priced above by size, so it has no flat price here."
      >
        <CatalogEditor
          items={draft.addons}
          prices={draft.pricing.addons}
          priceless={["bath"]}
          onChange={(items, prices) =>
            setDraft({ ...draft, addons: items, pricing: { ...draft.pricing, addons: prices } })
          }
        />
      </Section>

      {/* Boarding add-ons */}
      <Section
        title="Package pricing"
        blurb="The blocks of daycare days you sell. Selling a package picks one of these, so the price list stays consistent and the discount is deliberate."
      >
        <PackageTierEditor
          tiers={draft.packageTiers}
          fullDay={draft.pricing.daycareFullDay}
          onChange={(packageTiers) => setDraft({ ...draft, packageTiers })}
        />
      </Section>

      <Section title="Boarding add-on rates" blurb="Booked per stay on the reservation.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Money
            label="Walk (per walk)"
            value={draft.pricing.boardingWalkPerWalk}
            onChange={(v) => patchPricing({ boardingWalkPerWalk: v })}
          />
          <Money
            label="Medication (per day)"
            value={draft.pricing.boardingMedicationPerDay}
            onChange={(v) => patchPricing({ boardingMedicationPerDay: v })}
          />
          <Money
            label="Nail trim (per stay)"
            value={draft.pricing.boardingNailTrim}
            onChange={(v) => patchPricing({ boardingNailTrim: v })}
          />
        </div>
      </Section>

      {/* Services */}
      <Section
        title="Services"
        blurb="Rename or re-icon the services the kiosk offers. Adding a brand-new service still needs a code change — daycare, boarding, and meet & greet each have their own pricing and booking rules."
      >
        <CatalogEditor
          items={draft.services}
          onChange={(items) => setDraft({ ...draft, services: items })}
          allowAdd={false}
        />
      </Section>

      <div className="mb-10 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-medium text-white shadow-card hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
        <button
          onClick={() => {
            if (window.confirm("Reset every setting back to the shipped defaults?")) {
              setDraft(DEFAULT_SETTINGS);
            }
          }}
          className="text-xs font-medium text-slate-400 hover:text-slate-600"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}

// Add, rename, re-icon, reprice, and remove catalog entries. Built-ins can
// be edited but not deleted — code paths depend on their keys existing.
function CatalogEditor({
  items,
  prices,
  priceless = [],
  onChange,
  allowAdd = true,
}: {
  items: CatalogItem[];
  prices?: Record<string, number>;
  priceless?: string[];
  onChange: (items: CatalogItem[], prices: Record<string, number>) => void;
  allowAdd?: boolean;
}) {
  const [newLabel, setNewLabel] = useState("");
  const [newIcon, setNewIcon] = useState("✨");
  const [newPrice, setNewPrice] = useState("");

  function update(next: CatalogItem[], nextPrices?: Record<string, number>) {
    onChange(next, nextPrices ?? prices ?? {});
  }

  function add() {
    const label = newLabel.trim();
    if (!label) return;
    // Derive a stable key from the label — it's what gets written into
    // signins.addons, so it must not change when the label is edited later.
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (!key || items.some((i) => i.key === key)) return;
    update(
      [...items, { key, label, icon: newIcon.trim() || "✨" }],
      { ...(prices ?? {}), [key]: parseFloat(newPrice) || 0 }
    );
    setNewLabel("");
    setNewIcon("✨");
    setNewPrice("");
  }

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={item.key} className="flex flex-wrap items-center gap-2">
          <input
            value={item.icon}
            onChange={(e) => {
              const next = [...items];
              next[i] = { ...item, icon: e.target.value };
              update(next);
            }}
            className="w-14 rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-center text-sm outline-none focus:border-accent-500"
          />
          <input
            value={item.label}
            onChange={(e) => {
              const next = [...items];
              next[i] = { ...item, label: e.target.value };
              update(next);
            }}
            className="min-w-[8rem] flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm outline-none focus:border-accent-500"
          />
          {prices && !priceless.includes(item.key) && (
            <div className="flex items-center gap-1">
              <span className="text-sm text-slate-400">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={prices[item.key] ?? 0}
                onChange={(e) =>
                  update(items, { ...prices, [item.key]: parseFloat(e.target.value) || 0 })
                }
                className="w-24 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-accent-500"
              />
            </div>
          )}
          {prices && priceless.includes(item.key) && (
            <span className="text-[11px] text-slate-400">priced by size above</span>
          )}
          {item.builtin ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
              built in
            </span>
          ) : (
            <button
              onClick={() => update(items.filter((x) => x.key !== item.key))}
              className="rounded-lg border border-rose-200 px-2.5 py-1 text-[11px] text-rose-500 hover:border-rose-300"
            >
              Remove
            </button>
          )}
        </div>
      ))}

      {allowAdd && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <input
            value={newIcon}
            onChange={(e) => setNewIcon(e.target.value)}
            className="w-14 rounded-xl border border-slate-200 bg-white px-2 py-2 text-center text-sm outline-none focus:border-accent-500"
          />
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="New add-on name"
            className="min-w-[10rem] flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm outline-none focus:border-accent-500"
          />
          <div className="flex items-center gap-1">
            <span className="text-sm text-slate-400">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              placeholder="0.00"
              className="w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-accent-500"
            />
          </div>
          <button
            onClick={add}
            disabled={!newLabel.trim()}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:border-accent-300 disabled:opacity-50"
          >
            + Add
          </button>
        </div>
      )}
    </div>
  );
}

// The blocks of days the business sells. Each row shows its effective
// per-day rate against the walk-in price, so it's obvious at a glance
// whether a tier is actually a discount.
function PackageTierEditor({
  tiers,
  fullDay,
  onChange,
}: {
  tiers: PackageTier[];
  fullDay: number;
  onChange: (tiers: PackageTier[]) => void;
}) {
  const [newDays, setNewDays] = useState("");
  const [newPrice, setNewPrice] = useState("");

  function add() {
    const days = parseInt(newDays);
    const price = parseFloat(newPrice);
    if (!days || days < 1 || Number.isNaN(price)) return;
    if (tiers.some((t) => t.days === days)) return; // one tier per day count
    onChange([...tiers, { days, price }].sort((a, b) => a.days - b.days));
    setNewDays("");
    setNewPrice("");
  }

  return (
    <div className="space-y-2">
      {tiers.map((tier, i) => {
        const perDay = tier.days > 0 ? tier.price / tier.days : 0;
        const saves = fullDay - perDay;
        return (
          <div key={tier.days} className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={1}
              value={tier.days}
              onChange={(e) => {
                const next = [...tiers];
                next[i] = { ...tier, days: Math.max(1, parseInt(e.target.value) || 1) };
                onChange(next);
              }}
              className="w-20 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-accent-500"
            />
            <span className="text-sm text-slate-500">days for</span>
            <div className="flex items-center gap-1">
              <span className="text-sm text-slate-400">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={tier.price}
                onChange={(e) => {
                  const next = [...tiers];
                  next[i] = { ...tier, price: parseFloat(e.target.value) || 0 };
                  onChange(next);
                }}
                className="w-28 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-accent-500"
              />
            </div>
            <span className="text-[11px] text-slate-400">
              ${perDay.toFixed(2)}/day
              {saves > 0 ? (
                <span className="ml-1 font-medium text-emerald-600">
                  saves ${saves.toFixed(2)}/day
                </span>
              ) : (
                // Worth flagging — a tier priced at or above the walk-in rate
                // gives the client no reason to buy it.
                <span className="ml-1 font-medium text-amber-600">no saving vs walk-in</span>
              )}
            </span>
            <button
              onClick={() => onChange(tiers.filter((t) => t.days !== tier.days))}
              className="rounded-lg border border-rose-200 px-2.5 py-1 text-[11px] text-rose-500 hover:border-rose-300"
            >
              Remove
            </button>
          </div>
        );
      })}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <input
          type="number"
          min={1}
          value={newDays}
          onChange={(e) => setNewDays(e.target.value)}
          placeholder="10"
          className="w-20 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-accent-500"
        />
        <span className="text-sm text-slate-500">days for</span>
        <div className="flex items-center gap-1">
          <span className="text-sm text-slate-400">$</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="600.00"
            className="w-28 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-accent-500"
          />
        </div>
        <button
          onClick={add}
          disabled={!newDays || !newPrice}
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:border-accent-300 disabled:opacity-50"
        >
          + Add tier
        </button>
      </div>
      {tiers.length === 0 && (
        <p className="text-[11px] text-amber-700">
          No tiers configured — staff will have to enter a price by hand on every sale.
        </p>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100";

function Money({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-1">
        <span className="text-sm text-slate-400">$</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className={inputClass}
        />
      </div>
    </Field>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] text-slate-400">{label}</label>
      {children}
    </div>
  );
}

function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      {blurb && <p className="mb-3 mt-1 text-[11px] text-slate-400">{blurb}</p>}
      {!blurb && <div className="mb-3" />}
      {children}
    </section>
  );
}
