import type { Metadata } from "next";
import { WHATSAPP_DISPLAY } from "@/lib/hosts";
import { DraftNotice, PageHero, Prose } from "../parts";

export const metadata: Metadata = {
  title: "Terms · Kiota",
  description: "The terms for schools, staff and parents using Kiota.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <>
      <PageHero title="Terms of use" intro="Last updated: November 2026." />
      <DraftNotice />
      <Prose>
        <p>
          These terms apply to everyone who uses Kiota (kiota.app and app.kiota.app): schools, their
          staff, and parents and guardians. Kiota is provided by Arend Studio, Nairobi. Each school
          also signs a service agreement and a data processing agreement with Arend Studio; if
          anything here conflicts with those agreements, the agreements apply.
        </p>

        <h2>1. Accounts</h2>
        <ul>
          <li>
            There is no self sign-up. Arend Studio sets up each school, and the school adds its
            staff, students and guardians.
          </li>
          <li>
            You sign in with your own phone number and a one-time SMS code. Do not share codes or
            let anyone else use your account.
          </li>
          <li>A school can change what a staff member may do, or remove them, at any time.</li>
        </ul>

        <h2>2. Acceptable use</h2>
        <ul>
          <li>Use Kiota only for the school&apos;s work, or as a parent for your own children.</li>
          <li>
            Do not try to see data you are not meant to see, test the security without written
            permission, or disrupt the service.
          </li>
          <li>Do not upload unlawful content or anything that is not yours to share.</li>
        </ul>

        <h2>3. The school&apos;s responsibilities</h2>
        <ul>
          <li>
            The school is the data controller. It is responsible for having a lawful basis for the
            data it records, for informing parents, and for keeping records accurate.
          </li>
          <li>
            The school decides who may approve leave-outs, see medical records and handle money, and
            keeps those permissions up to date.
          </li>
          <li>The school pays the agreed subscription and messaging charges on time.</li>
        </ul>

        <h2>4. Arend Studio&apos;s responsibilities</h2>
        <ul>
          <li>Run Kiota with care and keep it secure, as described in our privacy policy.</li>
          <li>Process school data only on the school&apos;s instructions.</li>
          <li>Back up data every night and help the school recover from mistakes.</li>
          <li>Tell the school without delay about any data breach that affects it.</li>
        </ul>

        <h2>5. Money records</h2>
        <p>
          Payments and receipts in Kiota are permanent. They are never edited or deleted; mistakes
          are corrected by a reversal that records the reason and who made it. M-Pesa payments are
          processed by Safaricom under its own terms. Kiota records payments but does not hold
          school or parent funds.
        </p>

        <h2>6. Messaging</h2>
        <p>
          SMS and WhatsApp messages are paid for from the school&apos;s prepaid wallet. When the
          wallet is empty, sending stops except for messages the school marks critical. Delivery
          depends on mobile networks and WhatsApp and cannot be guaranteed.
        </p>

        <h2>7. Availability and changes</h2>
        <p>
          We aim to keep Kiota available at all times but may need short maintenance windows,
          announced in advance where possible. We improve Kiota regularly and will tell schools
          about changes that affect how they work.
        </p>

        <h2>8. Ending the service</h2>
        <p>
          A school may stop using Kiota as set out in its service agreement. Arend Studio will
          return the school&apos;s data in a standard format and then delete it, except where the
          law requires us to keep it.
        </p>

        <h2>9. Liability</h2>
        <p>
          Arend Studio is responsible for losses caused by its own failure to meet these terms or
          the law, up to the limits set in the school&apos;s service agreement. Nothing in these
          terms limits liability that cannot be limited under Kenyan law.
        </p>

        <h2>10. Law and contact</h2>
        <p>
          These terms are governed by the laws of Kenya. Questions: Arend Studio, Nairobi, WhatsApp{" "}
          {WHATSAPP_DISPLAY}.
        </p>
      </Prose>
    </>
  );
}
