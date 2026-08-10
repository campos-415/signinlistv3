import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import Section from "@/components/Section";
import ServiceCard from "@/components/ServiceCard";
import CTABand from "@/components/CTABand";
import { BUSINESS } from "@/lib/business";
import { AddressPill, HoursLine } from "@/components/BusinessBits";
import { HeroPhoto } from "@/components/SitePhotoSpots";
import Reviews from "@/components/Reviews";
import { REVIEW_SUMMARY } from "@/lib/reviews";

export const metadata: Metadata = {
  title: "Dog Daycare & Cage-Free Boarding in San Francisco",
  description:
    "Lombard Doggy Daycare offers supervised daycare, cage-free overnight boarding, bathing, and dog walking on Lombard Street in San Francisco. Book a meet & greet today.",
  alternates: { canonical: "/" },
};

const SERVICES = [
  {
    href: "/dog-daycare",
    title: "Daycare",
    description: "Supervised play, socialization, and exercise for adult dogs and pups.",
    image:
      "https://images.unsplash.com/photo-1620021030259-977a6aa9006f?auto=format&fit=crop&w=800&q=80",
    imageAlt: "Dogs socializing together at daycare",
  },
  {
    href: "/boarding",
    title: "Boarding",
    description: "Cage-free overnight stays with a pet-loving team on-site around the clock.",
    image:
      "https://images.unsplash.com/photo-1529472119196-cb724127a98e?auto=format&fit=crop&w=800&q=80",
    imageAlt: "Dog relaxing comfortably during overnight boarding",
  },
  {
    href: "/bath",
    title: "Bath",
    description: "A calming bath, brushing, nail trim, and ear cleaning during daycare hours.",
    image:
      "https://images.unsplash.com/photo-1561037404-61cd46aa615b?auto=format&fit=crop&w=800&q=80",
    imageAlt: "Dog getting a bath",
  },
  {
    href: "/dog-walking",
    title: "Dog Walking",
    description: "Solo or pack walks around the neighborhood, on their schedule or yours.",
    image:
      "https://images.unsplash.com/photo-1477884213360-7e9d7dcc1e48?auto=format&fit=crop&w=800&q=80",
    imageAlt: "Dog on a walk with a handler",
  },
];

const VALUE_PROPS = [
  {
    title: "Trained eyes on every playgroup",
    description:
      "Our staff actively supervises play sessions and groups dogs by size, temperament, and energy level — not just first-come, first-served.",
  },
  {
    title: "Veterinary knowledge on-site",
    description:
      "With a background in veterinary medicine on our team, we know what healthy, happy play looks like — and when a dog needs a breather.",
  },
  {
    title: "Cage-free, always",
    description:
      "Boarding dogs relax in comfortable shared spaces, not crates, with a team member on-site overnight.",
  },
  {
    title: "Everything in one place",
    description:
      "Daycare, boarding, baths, and walks — so your dog's whole routine is handled by people who already know them.",
  },
];

export default function HomePage() {
  return (
    <>
      <section className="border-b border-slate-100 bg-gradient-to-b from-accent-50/60 to-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-14 sm:px-8 md:grid-cols-2 md:py-24">
          <div>
            <AddressPill />
            <p className="inline-flex items-center gap-1.5 rounded-full bg-accent-50 px-3.5 py-1.5 text-sm font-semibold text-accent-700">
              ★ {REVIEW_SUMMARY.average.toFixed(1)} ({REVIEW_SUMMARY.count}{" "}
              {REVIEW_SUMMARY.source} reviews)
            </p>
            <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-5xl">
              {BUSINESS.tagline}
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-slate-600">
              Dogs are pack animals — they need to move, sniff, run, and
              socialize. We give them a fun, safe, supervised place to do
              exactly that, every single day.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/enroll"
                className="rounded-full bg-accent-500 px-6 py-3 text-sm font-semibold text-accent-ink shadow-card transition hover:bg-accent-600">
                Enroll Now
              </Link>
              <Link
                href="/book"
                className="rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-accent-300">
                Reserve Boarding
              </Link>
            </div>
            <HoursLine />
          </div>
          <HeroPhoto kind="hero" fallbackAlt="Dogs playing together at Lombard Doggy Daycare" priority />
        </div>
      </section>

      <Section
        eyebrow="What we offer"
        title="Everything your dog's routine needs"
        description="Pick one service or bundle them together — our team keeps your dog's whole schedule in one place.">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICES.map((service) => (
            <ServiceCard key={service.href} {...service} />
          ))}
        </div>
      </Section>

      <section className="bg-slate-50">
        <Section
          eyebrow="Why pack parents choose us"
          title="Care that treats your dog like part of the pack">
          <div className="grid gap-8 sm:grid-cols-2">
            {VALUE_PROPS.map((prop) => (
              <div key={prop.title} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent-100 text-lg">
                  🐕
                </span>
                <div>
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    {prop.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                    {prop.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </section>

      <Section
        eyebrow="Meet the team"
        title="Run by people who actually love dogs"
        description="Luis brings veterinary medicine expertise, Roberto oversees day-to-day operations, and Meshal keeps things running smoothly behind the scenes — together they built Lombard Doggy Daycare around one idea: dogs do best with movement, structure, and a pack.">
        <Link
          href="/about-us"
          className="inline-block text-sm font-semibold text-accent-600 hover:text-accent-700">
          Get to know the team →
        </Link>
      </Section>
      <section className="bg-slate-50">
        <Section eyebrow="Reviews" title="What pack parents are saying">
          <Reviews />
        </Section>
      </section>

      <CTABand />
    </>
  );
}
