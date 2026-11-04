import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { WHATSAPP_URL } from "@/lib/hosts";
import { Band, CallToAction, Container, Feature, Ticks } from "./parts";

export const metadata: Metadata = {
  title: { absolute: "Kiota: every child, one place" },
  description:
    "Kiota runs fees, report cards, parent messages and boarding for Kenyan schools, from primary to senior school.",
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <>
      <section>
        <Container className="flex flex-col items-start gap-8 py-14 sm:py-20 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <h1 className="font-heading text-5xl font-bold tracking-tight text-teal sm:text-6xl">
              Every child, one place.
            </h1>
            <p className="mt-5 text-lg text-ink/85 sm:text-xl">
              Kiota runs fees, report cards, parent messages and boarding for Kenyan schools, from
              primary to senior school.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/demo"
                className="inline-flex h-12 items-center justify-center rounded-xl bg-teal px-6 font-semibold text-white hover:bg-teal/90"
              >
                Book a demo
              </Link>
              <a
                href={WHATSAPP_URL}
                rel="noopener"
                className="inline-flex h-12 items-center justify-center rounded-xl border border-teal/30 bg-white px-6 font-semibold text-teal hover:bg-egg-blue/30"
              >
                Chat on WhatsApp
              </a>
            </div>
          </div>
          <Image
            src="/brand/kiota-icon.svg"
            alt=""
            width={200}
            height={200}
            priority
            className="hidden md:block"
          />
        </Container>
      </section>

      <Band
        tone="blue"
        title="Built for boarding schools"
        intro="Most school systems stop at fees and exams. Kiota also runs the boarding side of school, and tells parents as things happen."
      >
        <Ticks
          items={[
            "Leave-out with an SMS to parents when a child leaves and returns",
            "Dormitories, beds and evening roll call",
            "Pocket money that parents top up by M-Pesa",
            "Sick bay visits, with medical details kept private",
            "Food stores: what each meal costs to serve",
            "Only the staff the Director chooses can approve leave-outs",
          ]}
        />
      </Band>

      <Band title="Fees without the paperwork">
        <div className="grid gap-4 md:grid-cols-3">
          <Feature title="M-Pesa, straight to the right child">
            Parents pay to your Paybill with the admission number, or tap Pay and confirm with STK
            Push. Each payment lands on the right student automatically.
          </Feature>
          <Feature title="Receipts that write themselves">
            Every payment gets a numbered receipt, printed on your thermal or A4 printer or sent on
            WhatsApp. Receipts are never edited or deleted.
          </Feature>
          <Feature title="Balances parents can see">
            Parents see their fee balance and every receipt on their phone, so the bursar answers
            fewer calls.
          </Feature>
        </div>
      </Band>

      <Band
        tone="blue"
        title="Report cards that explain themselves"
        intro="Teachers enter marks once. Kiota produces the report cards and the analysis."
      >
        <Ticks
          items={[
            "CBC performance levels and 8-4-4 grades, set up for your school",
            "Graphs parents understand: progress across terms and subjects",
            "Class and stream analysis for teachers and the principal",
            "Report cards delivered to parents as a secure link",
          ]}
        />
      </Band>

      <Band
        title="One app for every parent"
        intro="One sign-in with a phone number and an SMS code shows all of a parent's children, even when they are at different schools. No passwords to forget."
      >
        <Link href="/parents" className="font-semibold text-teal hover:underline">
          What parents see →
        </Link>
      </Band>

      <Band tone="blue" title="Safe by design">
        <Ticks
          items={[
            "Built to the Kenya Data Protection Act, 2019",
            "Each school's data is walled off from every other school, in the database itself",
            "No self sign-up: every school is set up by Arend Studio",
            "Medical notes visible only to the staff who need them",
            "Every change to money, marks and permissions is recorded",
            "Your school decides when Arend Studio support may look in",
          ]}
        />
        <Link
          href="/security"
          className="mt-6 inline-block font-semibold text-teal hover:underline"
        >
          Security and privacy →
        </Link>
      </Band>

      <CallToAction />
    </>
  );
}
