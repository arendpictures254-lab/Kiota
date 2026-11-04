import type { Metadata } from "next";
import { Shell } from "@/components/ui";
import { SITE_URL } from "@/lib/hosts";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in · Kiota",
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <Shell title="Sign in">
      <SignInForm />
      <p className="text-sm text-ink/60">
        Kiota accounts are created by your school; there is no sign-up. Running a school?{" "}
        <a href={`${SITE_URL}/demo`} className="font-semibold text-teal hover:underline">
          Book a demo
        </a>
        .
      </p>
    </Shell>
  );
}
