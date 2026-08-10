import type { Metadata } from "next";
import Link from "next/link";
import PageHero from "@/components/PageHero";
import Section from "@/components/Section";
import CTABand from "@/components/CTABand";

export const metadata: Metadata = {
  title: "Dog Bathing & Grooming in San Francisco",
  description:
    "Calming dog baths, brushing, nail trims, and ear cleaning — added seamlessly to your dog's daycare visit in San Francisco.",
  alternates: { canonical: "/bath" },
};

export default function BathPage() {
  return (
    <>
      <PageHero
        eyebrow="Bath & Grooming"
        title="Give your dog a refreshing bath during daycare time."
        description="No separate trip, no extra stress. Our in-house specialist works bath time into your dog's regular daycare visit, with a calm, patient approach for dogs who aren't sure about water."
        image="https://images.unsplash.com/photo-1561037404-61cd46aa615b?auto=format&fit=crop&w=1200&q=80"
        imageAlt="Dog getting a calm, gentle bath"
        primaryHref="/enroll"
      />

      <Section
        eyebrow="What's included"
        title="A full refresh, not just a rinse">
        <div className="grid gap-6 sm:grid-cols-3">
          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-card">
            <h3 className="font-display text-base font-semibold text-slate-900">
              Bath
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              A calming, thorough bath sized to your dog.
            </p>
          </div>
          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-card">
            <h3 className="font-display text-base font-semibold text-slate-900">
              Brush &amp; Nail Trim
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              A full brush-out plus a nail trim, available for any size dog.
            </p>
          </div>
          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-card">
            <h3 className="font-display text-base font-semibold text-slate-900">
              Ear Cleaning
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              A gentle ear cleaning to round out the visit.
            </p>
          </div>
        </div>
        <p className="mt-6 text-sm text-slate-500">
          Pricing is based on your dog's size — see{" "}
          <Link href="/prices" className="font-semibold text-accent-600">
            bath &amp; grooming rates
          </Link>
          .
        </p>
      </Section>

      <CTABand
        title="Add a bath to your dog's next visit"
        description="Just let us know when you drop off, and we'll work it into their daycare day."
      />
    </>
  );
}
