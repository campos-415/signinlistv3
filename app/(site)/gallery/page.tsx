import type { Metadata } from "next";
import Section from "@/components/Section";
import CTABand from "@/components/CTABand";
import GalleryGrid from "@/components/GalleryGrid";

export const metadata: Metadata = {
  title: "Gallery",
  description:
    "A look inside daycare and boarding at Lombard Doggy Daycare in San Francisco.",
  alternates: { canonical: "/gallery" },
};

// The photos themselves are uploaded on /settings and rendered by
// GalleryGrid, which falls back to stock images until there are any.
export default function GalleryPage() {
  return (
    <>
      <Section
        eyebrow="Gallery"
        title="A peek inside the pack"
        description="A look at daycare, boarding, bath day and everything in between."
        className="pt-14 sm:pt-20"
      >
        <GalleryGrid />
      </Section>

      <CTABand />
    </>
  );
}
