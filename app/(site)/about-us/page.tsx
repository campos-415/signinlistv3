import type { Metadata } from "next";
import Section from "@/components/Section";
import { HeroPhoto, TeamGrid } from "@/components/SitePhotoSpots";
import CTABand from "@/components/CTABand";

export const metadata: Metadata = {
  title: "About Us",
  description:
    "Meet the team behind Lombard Doggy Daycare in San Francisco and learn our approach to daycare, boarding, and dog care.",
  alternates: { canonical: "/about-us" },
};

export default function AboutPage() {
  return (
    <>
      <section className="border-b border-slate-100 bg-gradient-to-b from-accent-50/60 to-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-14 sm:px-8 md:grid-cols-2 md:py-20">
          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-accent-600">
              About Us
            </p>
            <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-4xl">
              Dogs are pack animals. We built a place for them to act like it.
            </h1>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-slate-600">
              Lombard Doggy Daycare exists because dogs need more than a backyard —
              they need to move, sniff, run, and socialize. We give pet owners peace
              of mind while their dogs get real, supervised playtime with a pack that
              fits them.
            </p>
          </div>
          <HeroPhoto kind="about" fallbackAlt="Dog enjoying time at daycare" />
        </div>
      </section>

      <Section eyebrow="Our team" title="The people behind the pack">
        <TeamGrid />
      </Section>

      <section className="bg-slate-50">
        <Section
          eyebrow="Our approach"
          title="Small, well-matched playgroups — always supervised"
          description="Every dog is grouped by size, energy, and temperament, and a trained staff member actively watches every session. It's the same reason we require a quick temperament check before any dog's first visit — it keeps every day safe and genuinely fun."
        />
      </section>

      <CTABand />
    </>
  );
}
