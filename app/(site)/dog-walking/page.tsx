import type { Metadata } from "next";
import Link from "next/link";
import PageHero from "@/components/PageHero";
import Section from "@/components/Section";
import CTABand from "@/components/CTABand";

export const metadata: Metadata = {
  title: "Dog Walking in San Francisco",
  description:
    "Solo dog walks around the Lombard Street neighborhood in San Francisco, available as single walks or a 10-day package with no expiration.",
  alternates: { canonical: "/dog-walking" },
};

export default function DogWalkingPage() {
  return (
    <>
      <PageHero
        eyebrow="Dog Walking"
        title="A midday walk when you can't get away."
        description="A 30-minute neighborhood walk to stretch legs, sniff the block, and break up a long day home alone — booked as a one-off or a standing package."
        image="https://images.unsplash.com/photo-1477884213360-7e9d7dcc1e48?auto=format&fit=crop&w=1200&q=80"
        imageAlt="Dog on a walk with a handler in the neighborhood"
        primaryHref="/enroll"
      />

      <Section eyebrow="How it works" title="Flexible, no-expiration packages">
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-card">
            <h3 className="font-display text-lg font-semibold text-slate-900">
              Single Walk
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              A 30-minute walk around the neighborhood, booked whenever you need
              it.
            </p>
          </div>
          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-card">
            <h3 className="font-display text-lg font-semibold text-slate-900">
              10-Day Package
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Prepay for 10 walks and use them whenever — the package never
              expires.
            </p>
          </div>
        </div>
        <p className="mt-6 text-sm text-slate-500">
          See exact rates on the{" "}
          <Link href="/prices" className="font-semibold text-accent-600">
            prices page
          </Link>
          .
        </p>
      </Section>

      <CTABand
        title="Set up a standing walk schedule"
        description="Tell us your dog's routine and we'll build a walking schedule around it."
      />
    </>
  );
}
