import type { Metadata } from "next";
import Section from "@/components/Section";
import ContactForm from "@/components/ContactForm";
import { ContactCards } from "@/components/BusinessBits";

export const metadata: Metadata = {
  title: "Contact Us",
  description:
    "Get in touch with Lombard Doggy Daycare in San Francisco — call, text, email, or send a message to book a meet & greet.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <Section
      eyebrow="Contact"
      title="Let's find your dog's new favorite spot"
      description="Reach out with any questions, or send a message to start enrollment — we typically reply the same day."
      className="pt-14 sm:pt-20">
      <div className="grid gap-10 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <ContactForm />
        </div>
        <ContactCards />
      </div>
    </Section>
  );
}
