import type { Metadata } from "next";
import Link from "next/link";
import { Band, CallToAction, Feature, PageHero } from "../parts";

export const metadata: Metadata = {
  title: "Security and privacy · Kiota",
  description:
    "How Kiota protects school and family data: Kenya Data Protection Act 2019, school-by-school walls in the database, no self sign-up, restricted medical records and a full audit log.",
  alternates: { canonical: "/security" },
};

export default function SecurityPage() {
  return (
    <>
      <PageHero
        title="Security and privacy"
        intro="Schools trust Kiota with children's records and families' money. These are the rules we build to."
      />
      <Band title="Who is responsible" tone="blue">
        <div className="grid gap-4 md:grid-cols-2">
          <Feature title="Your school is the data controller">
            The school decides what is recorded and why. Under the Data Protection Act, 2019,
            parents exercise their rights through the school.
          </Feature>
          <Feature title="Arend Studio is the data processor">
            We run Kiota for the school under a signed data processing agreement, and use the data
            only to provide the service.
          </Feature>
        </div>
      </Band>
      <Band title="How data is protected">
        <div className="grid gap-4 md:grid-cols-3">
          <Feature title="Walls between schools">
            Every record carries its school. The database itself refuses to show one school&apos;s
            records to another, even if a mistake slipped into the code.
          </Feature>
          <Feature title="No self sign-up">
            Nobody can create an account. Arend Studio sets up each school; the school adds its
            staff and parents by phone number.
          </Feature>
          <Feature title="Sign in with an SMS code">
            One-time codes expire in five minutes and allow five tries. There are no passwords to
            leak or reuse.
          </Feature>
          <Feature title="Each person sees their own work">
            Permissions are checked on the server for every action. Medical notes are visible only
            to the staff the school allows.
          </Feature>
          <Feature title="A record of every change">
            Money, marks, leave-outs and permissions: who did what, and when, is kept and cannot be
            edited.
          </Feature>
          <Feature title="Support only when you ask">
            Arend Studio cannot see a school&apos;s records unless the Director turns on support
            access, for a limited time.
          </Feature>
        </div>
      </Band>
      <Band
        tone="blue"
        title="Hosting and backups"
        intro="Connections to Kiota are encrypted (HTTPS). The database is backed up every night and backups are kept for 14 days. Data is hosted in or near Kenya."
      >
        <p className="text-ink/80">
          Read the{" "}
          <Link href="/privacy" className="font-semibold text-teal hover:underline">
            privacy policy
          </Link>{" "}
          for what data Kiota holds and for how long.
        </p>
      </Band>
      <CallToAction />
    </>
  );
}
