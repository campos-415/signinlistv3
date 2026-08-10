import type { Metadata } from "next";
import Section from "@/components/Section";
import PriceTables from "@/components/PriceTables";
import CTABand from "@/components/CTABand";

export const metadata: Metadata = {
  title: "Prices",
  description:
    "See pricing for dog daycare, cage-free boarding, bathing, and dog walking at Lombard Doggy Daycare in San Francisco.",
  alternates: { canonical: "/prices" },
};

export default function PricesPage() {
  return (
    <>
      <Section
        eyebrow="Prices"
        title="Simple, transparent pricing"
        description="No surprise fees — just what's below, plus any add-ons you choose."
        className="pt-14 sm:pt-20">
        <PriceTables />
      </Section>

      <CTABand />
    </>
  );
}
