import type { Metadata } from "next";
import { Shell } from "@/components/ui";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in · Kiota" };

export default function SignInPage() {
  return (
    <Shell title="Sign in">
      <SignInForm />
    </Shell>
  );
}
