import type { Metadata } from "next";
import { WHATSAPP_DISPLAY, WHATSAPP_URL } from "@/lib/hosts";
import { Container, PageHero } from "../parts";
import { DemoForm } from "./demo-form";

export const metadata: Metadata = {
  title: "Book a demo · Kiota",
  description:
    "See Kiota with your own school in mind. Tell us about your school and we'll arrange a 30-minute demo.",
  alternates: { canonical: "/demo" },
};

export default function DemoPage() {
  return (
    <>
      <PageHero
        title="Book a demo"
        intro="Tell us about your school and we will arrange a 30-minute demo, in person in Nairobi and the coast, or online."
      />
      <Container className="grid gap-8 pb-16 md:grid-cols-[1fr_280px]">
        <DemoForm whatsappUrl={WHATSAPP_URL} />
        <aside className="flex flex-col gap-3 text-ink/80">
          <h2 className="font-heading text-lg font-bold text-ink">Rather talk now?</h2>
          <p>
            Chat with us on WhatsApp:{" "}
            <a
              href={WHATSAPP_URL}
              rel="noopener"
              className="font-semibold text-teal hover:underline"
            >
              {WHATSAPP_DISPLAY}
            </a>
          </p>
          <p className="text-sm">
            Kiota is set up for each school by Arend Studio. There is no self sign-up.
          </p>
        </aside>
      </Container>
    </>
  );
}
