import type { Metadata } from "next";
import Link from "next/link";
import PageHero from "@/components/PageHero";
import Section from "@/components/Section";
import CTABand from "@/components/CTABand";

export const metadata: Metadata = {
  title: "Cage-Free Dog Boarding in San Francisco",
  description:
    "Overnight dog boarding on Lombard Street in San Francisco — cage-free accommodations with a pet-loving team on-site around the clock, plus daytime play included.",
  alternates: { canonical: "/boarding" },
};

const AMENITIES = [
  {
    title: "Safe, cozy accommodations",
    description: "A clean, secure, comfortable space to rest — never a crate.",
  },
  {
    title: "Overnight supervision",
    description: "A pet-loving team member is on-site around the clock, every night.",
  },
  {
    title: "Daytime play included",
    description: "Boarding guests join daycare playgroups during the day at no extra cost.",
  },
  {
    title: "Customized care",
    description: "Dietary needs and medication schedules are handled exactly how you specify.",
  },
];

export default function BoardingPage() {
  return (
    <>
      <PageHero
        eyebrow="Boarding"
        title="Cage-free boarding with a pet-loving team on-site overnight."
        description="A home away from home for your dog while you're away — safe, comfortable, and never in a crate, with daytime play built right in."
        image="https://images.unsplash.com/photo-1529472119196-cb724127a98e?auto=format&fit=crop&w=1200&q=80"
        imageAlt="Dog resting comfortably during overnight boarding"
        primaryLabel="Reserve Boarding"
        primaryHref="/book"
      />

      <Section
        eyebrow="What's included"
        title="More than a place to sleep"
        description="Boarding at Lombard Doggy Daycare means your dog spends the day playing with their pack, then settles in for a calm, supervised night."
      >
        <div className="grid gap-6 sm:grid-cols-2">
          {AMENITIES.map((item) => (
            <div key={item.title} className="rounded-3xl border border-slate-100 bg-white p-6 shadow-card">
              <h3 className="font-display text-lg font-semibold text-slate-900">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.description}</p>
            </div>
          ))}
        </div>
      </Section>

      <section className="bg-slate-50">
        <Section eyebrow="Good to know" title="Before your dog's first stay">
          <ul className="space-y-3 text-sm text-slate-600">
            <li className="flex items-start gap-3">
              <span className="mt-0.5 text-accent-500">✓</span>
              A quick meet &amp; greet, plus current vaccinations
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-0.5 text-accent-500">✓</span>
              Two prior daycare visits are recommended so we know your dog before their first overnight stay
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-0.5 text-accent-500">✓</span>
              Optional transport service available for $25 one-way within 5 miles
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-0.5 text-accent-500">✓</span>
              Add a daily walk, medication support, or a second dog from the same address at a discount
            </li>
          </ul>
          <p className="mt-6 text-sm text-slate-500">
            See exact nightly rates and add-on pricing on our{" "}
            <Link href="/prices" className="font-semibold text-accent-600">
              prices page
            </Link>
            .
          </p>
        </Section>
      </section>

      <CTABand
        title="Traveling soon? Let's set up a meet & greet."
        description="Reservations are limited to keep our overnight guest list small and well-supervised — reach out early."
      />
    </>
  );
}
