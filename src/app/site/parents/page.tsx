import type { Metadata } from "next";
import { Band, CallToAction, Feature, PageHero, Ticks } from "../parts";

export const metadata: Metadata = {
  title: "For parents · Kiota",
  description:
    "One sign-in for all your children, even at different schools. See fees, receipts, results, leave-outs and school notices on your phone.",
  alternates: { canonical: "/parents" },
};

export default function ParentsPage() {
  return (
    <>
      <PageHero
        title="For parents: your children's school, on your phone"
        intro="When your school uses Kiota, you sign in with your phone number and a code sent by SMS. No password, no app to install first."
      />
      <Band title="What you can see" tone="blue">
        <div className="grid gap-4 md:grid-cols-3">
          <Feature title="Fees">
            Your balance, every invoice and receipt, and a Pay button that sends an M-Pesa prompt to
            your phone.
          </Feature>
          <Feature title="Results">
            Report cards and easy graphs: how your child is doing across terms and subjects.
          </Feature>
          <Feature title="Boarding">
            Leave-outs, a short summary of sick bay visits, and the pocket money balance.
          </Feature>
        </div>
      </Band>
      <Band
        title="All your children, one sign-in"
        intro="If your children are at different schools that use Kiota, they all appear in one app with a simple child switcher. The first time a new school links a child to your number, you confirm it with an SMS code."
      >
        <Ticks
          items={[
            "Each school sees only its own students: a school never learns about your other schools",
            "Messages in English or Kiswahili, your choice",
            "Your school decides which guardian receives fees, results or boarding alerts",
            "You can ask your school for a copy of your child's data",
          ]}
        />
      </Band>
      <Band
        tone="blue"
        title="How do I get access?"
        intro="You do not sign up yourself. Your school adds your phone number when it records your child. If your school uses Kiota and you cannot sign in, ask the school office to check your number."
      />
      <CallToAction />
    </>
  );
}
