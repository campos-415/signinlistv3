import type { Metadata } from "next";
import Link from "next/link";
import PageHero from "@/components/PageHero";
import Section from "@/components/Section";
import CTABand from "@/components/CTABand";

export const metadata: Metadata = {
  title: "Dog Daycare in San Francisco",
  description:
    "Supervised dog daycare on Lombard Street in San Francisco. Half-day and full-day options, trained staff, and small, temperament-matched playgroups.",
  alternates: { canonical: "/dog-daycare" },
};

const REQUIREMENTS = [
  "Current vaccinations: Distemper, Bordetella, Rabies, Canine Influenza, and Leptospirosis",
  "Spayed or neutered by 6 months of age",
  "Flea and tick free",
  "Collar and leash required at drop-off",
  "A quick temperament test before your dog's first visit",
];

export default function DaycarePage() {
  return (
    <>
      <PageHero
        eyebrow="Daycare"
        title="A day full of play, not a day in a crate."
        description="Dogs are pack animals — they need to move, sniff, run, and socialize. Our daycare gives adult dogs and pups a supervised, temperament-matched playgroup every weekday."
        image="https://images.unsplash.com/photo-1620021030259-977a6aa9006f?auto=format&fit=crop&w=1200&q=80"
        imageAlt="Dogs playing together in a supervised daycare playgroup"
        primaryHref="/enroll"
      />

      <Section
        eyebrow="How it works"
        title="Half day or full day — you decide"
        description="Drop off in the morning and pick up whenever fits your schedule. Every dog is grouped with playmates that match their size and energy, and a staff member is always supervising.">
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-card">
            <h3 className="font-display text-lg font-semibold text-slate-900">
              Half Day
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Under 4 hours — perfect for a morning appointment or a short
              errand run.
            </p>
          </div>
          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-card">
            <h3 className="font-display text-lg font-semibold text-slate-900">
              Full Day
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              A full day of play, rest, and socialization,{" "}
              <span className="font-medium text-slate-700">
                Monday – Friday, 7 AM – 7 PM
              </span>
              .
            </p>
          </div>
        </div>
        <p className="mt-6 text-sm text-slate-500">
          Ask about our 10-day daycare package for frequent visitors — see{" "}
          <Link href="/prices" className="font-semibold text-accent-600">
            current pricing
          </Link>
          . Late pickup fees apply after closing.
        </p>
      </Section>

      <section className="bg-slate-50">
        <Section
          eyebrow="Before their first visit"
          title="What your dog needs to join the pack">
          <ul className="grid gap-3 sm:grid-cols-2">
            {REQUIREMENTS.map((item) => (
              <li
                key={item}
                className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-white p-4 text-sm text-slate-600 shadow-card">
                <span className="mt-0.5 text-accent-500">✓</span>
                {item}
              </li>
            ))}
          </ul>
        </Section>
      </section>

      <Section
        eyebrow="While they're here"
        title="Add a bath to any daycare day"
        description="Our in-house specialist can give your dog a calming bath, brush-out, nail trim, and ear cleaning during their regular daycare visit — no separate trip needed.">
        <Link
          href="/bath"
          className="text-sm font-semibold text-accent-600 hover:text-accent-700">
          See bath &amp; grooming details →
        </Link>
      </Section>

      <CTABand
        title="Book your dog's first day"
        description="New to Lombard Doggy Daycare? We'll start with a quick meet & greet and temperament check."
      />
    </>
  );
}
