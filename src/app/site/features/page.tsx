import type { Metadata } from "next";
import { Band, CallToAction, Feature, PageHero } from "../parts";

export const metadata: Metadata = {
  title: "Features · Kiota",
  description:
    "Fees and M-Pesa, report cards for CBC and 8-4-4, parent messages, boarding, stores and student records: everything Kiota does for a Kenyan school.",
  alternates: { canonical: "/features" },
};

const groups: { title: string; tone?: "blue"; items: [string, string][] }[] = [
  {
    title: "Students and school setup",
    items: [
      [
        "One record per student",
        "Admission number, NEMIS UPI, class and stream, boarding, house and guardians, archived but never deleted.",
      ],
      [
        "Your structure, your settings",
        "Levels from PP1 to Grade 12 and Forms 3–4, streams, houses, dormitories, terms and subjects, all set in Kiota.",
      ],
      [
        "Excel import",
        "Load the whole school from one template. Kiota checks every row and explains every problem before anything is saved.",
      ],
    ],
  },
  {
    title: "Fees and finance",
    tone: "blue",
    items: [
      [
        "Fee structures",
        "Vote heads per level, term and boarding status, with bursaries, sibling discounts and instalment plans.",
      ],
      [
        "M-Pesa Paybill and STK Push",
        "Payments post to the right student automatically. Unmatched payments wait for the bursar.",
      ],
      [
        "Receipts and reversals",
        "Sequential receipts, printed or on WhatsApp. Mistakes are reversed with a reason and a name, never deleted.",
      ],
      [
        "Reports",
        "Collected against expected, defaulters with one-tap reminders, statements and an Excel export for the auditor.",
      ],
    ],
  },
  {
    title: "Academics",
    items: [
      [
        "Mark entry on any phone",
        "One class and subject at a time, locked once the class teacher signs off.",
      ],
      [
        "Report cards",
        "Branded templates with teacher and principal comments, printed or sent as a secure link.",
      ],
      [
        "Analysis",
        "Trends per student, class, stream, subject and teacher, as graphs anyone can read.",
      ],
    ],
  },
  {
    title: "Boarding",
    tone: "blue",
    items: [
      [
        "Leave-out",
        "Requests, Director-chosen approvers, gate passes with the child's photo, and an SMS on exit and return.",
      ],
      [
        "Dormitories and roll call",
        "Beds, capacity and evening roll call with a missing-student alert.",
      ],
      [
        "Pocket money and sick bay",
        "M-Pesa top-ups and daily limits; sick bay visits with referrals and parent alerts.",
      ],
    ],
  },
  {
    title: "Messaging and stores",
    items: [
      [
        "SMS and WhatsApp",
        "Your school's own sender name, English or Kiswahili, from a prepaid wallet you can always see.",
      ],
      [
        "Stores",
        "Stock in and out, uniforms charged to fee accounts, food issued per meal and monthly stock-takes.",
      ],
    ],
  },
];

export default function FeaturesPage() {
  return (
    <>
      <PageHero
        title="Everything a Kenyan school runs on"
        intro="Each person sees only their own work: the bursar sees fees, the class teacher sees their class, the gate guard sees one screen. Every common task takes three taps or fewer."
      />
      {groups.map((g) => (
        <Band key={g.title} title={g.title} tone={g.tone}>
          <div className="grid gap-4 md:grid-cols-3">
            {g.items.map(([title, text]) => (
              <Feature key={title} title={title}>
                {text}
              </Feature>
            ))}
          </div>
        </Band>
      ))}
      <CallToAction />
    </>
  );
}
