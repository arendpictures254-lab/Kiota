import type { Metadata } from "next";
import { WHATSAPP_DISPLAY } from "@/lib/hosts";
import { DraftNotice, PageHero, Prose } from "../parts";

export const metadata: Metadata = {
  title: "Privacy policy · Kiota",
  description:
    "What data Kiota holds for schools, students and families, who is responsible for it, how long it is kept and your rights under the Kenya Data Protection Act, 2019.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <>
      <PageHero title="Privacy policy" intro="Last updated: November 2026." />
      <DraftNotice />
      <Prose>
        <p>
          Kiota is a school management system built and run by Arend Studio, Nairobi. This policy
          explains what personal data Kiota holds, who is responsible for it, how it is protected,
          how long it is kept, and the rights of parents, students and staff under the Kenya Data
          Protection Act, 2019 (&ldquo;the Act&rdquo;).
        </p>

        <h2>1. Who is responsible for your data</h2>
        <p>
          <strong>Your school is the data controller.</strong> Each school decides what it records
          about its students, families and staff, and why. If your child&apos;s school uses Kiota,
          the school is responsible for that information.
        </p>
        <p>
          <strong>Arend Studio is the data processor.</strong> We store and process data on the
          school&apos;s behalf, only on its instructions and under a written data processing
          agreement. We do not sell personal data and do not use it for advertising. Arend Studio is
          registered (or is registering) with the Office of the Data Protection Commissioner.
        </p>
        <p>
          For the &ldquo;Book a demo&rdquo; form on this website, Arend Studio is the data
          controller (see section 7).
        </p>

        <h2>2. What data Kiota holds</h2>
        <ul>
          <li>
            <strong>Students:</strong> name, admission number, NEMIS UPI, date of birth, gender,
            photo, class, stream, house, boarding status, special needs, enrolment status and
            documents the school uploads (such as a birth certificate or transfer letter).
          </li>
          <li>
            <strong>Health:</strong> medical notes, allergies and sick bay visits. This is sensitive
            personal data. Only staff the school specifically allows can see it, and every change is
            recorded.
          </li>
          <li>
            <strong>Parents and guardians:</strong> name, phone number, relationship to the student,
            preferred language, which messages they receive, and whether they may collect the child
            at leave-out.
          </li>
          <li>
            <strong>Staff:</strong> name, phone number and roles at the school.
          </li>
          <li>
            <strong>School records:</strong> fees, invoices, payments, receipts and pocket money;
            marks, report cards and attendance; leave-outs, dormitory and stores records.
          </li>
          <li>
            <strong>Messages:</strong> the SMS and WhatsApp messages sent through Kiota and whether
            they were delivered.
          </li>
          <li>
            <strong>Security records:</strong> sign-in events and an audit log of who changed what
            and when, including the network (IP) address used.
          </li>
        </ul>

        <h2>3. Why it is used</h2>
        <p>
          To run the school: collecting and receipting fees, producing report cards, keeping
          students safe in boarding, and informing parents. The school&apos;s lawful basis for each
          purpose is set out in its own privacy notice to parents. Kiota does not make automated
          decisions about students.
        </p>

        <h2>4. Who can see it</h2>
        <ul>
          <li>Staff of the school, each limited to what their role needs.</li>
          <li>
            Parents and guardians, for their own children only, limited by the school&apos;s
            settings (for example, a sponsor may see fees but not results).
          </li>
          <li>
            Arend Studio support staff, only when the school turns on support access, for a limited
            time.
          </li>
          <li>
            Service providers that deliver parts of the service: the SMS provider, WhatsApp (Meta)
            for messages, Safaricom for M-Pesa payments, and our hosting provider. Each receives
            only what it needs.
          </li>
        </ul>
        <p>
          A school can never see another school&apos;s records. If a parent has children at more
          than one school, no school learns about the others.
        </p>

        <h2>5. How it is protected</h2>
        <p>
          Connections are encrypted (HTTPS). Each school&apos;s data is separated in the database
          itself. Sign-in uses one-time SMS codes. Permissions are checked on the server for every
          action. The database is backed up every night. Data is hosted in or near Kenya; if any
          data is transferred outside Kenya, it is done in line with the Act.
        </p>

        <h2>6. How long it is kept</h2>
        <ul>
          <li>
            While the school uses Kiota, records are kept for as long as the school needs them.
            Student records are archived when a student leaves, not deleted, so the school can issue
            transcripts and answer later questions.
          </li>
          <li>
            Financial records (payments, receipts, reversals) are kept for the period required by
            Kenyan tax and accounting law.
          </li>
          <li>Backups are kept for 14 days and then overwritten.</li>
          <li>
            When a school stops using Kiota, Arend Studio returns the school&apos;s data in a
            standard format and then deletes it from the service within 90 days, except where the
            law requires us to keep it.
          </li>
          <li>Demo requests from this website are kept for up to 24 months.</li>
        </ul>

        <h2>7. Demo requests from this website</h2>
        <p>
          When you book a demo, we collect your school&apos;s name and county, your name, role,
          phone number, optional email, the number of students and your message. We use this only to
          contact you about Kiota. Please do not include any child&apos;s details.
        </p>

        <h2>8. Your rights</h2>
        <p>Under the Act, you have the right to:</p>
        <ul>
          <li>be told how your data, or your child&apos;s, is used;</li>
          <li>access the data held about you or your child;</li>
          <li>have wrong or out-of-date data corrected;</li>
          <li>ask for data to be deleted, where the law allows;</li>
          <li>object to processing, and to receive data in a portable format.</li>
        </ul>
        <p>
          Because the school is the data controller, please make requests to your school first. The
          school can export a child&apos;s data from Kiota, and Arend Studio will help the school
          respond. You may also complain to the Office of the Data Protection Commissioner
          (www.odpc.go.ke).
        </p>

        <h2>9. Contact</h2>
        <p>
          Arend Studio, Nairobi. WhatsApp {WHATSAPP_DISPLAY}. For questions about your child&apos;s
          data, contact your school.
        </p>
      </Prose>
    </>
  );
}
