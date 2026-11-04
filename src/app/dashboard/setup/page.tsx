import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { Loading, Shell } from "@/components/ui";
import { requireSchool } from "@/lib/auth/context";

export const metadata: Metadata = { title: "School setup · Kiota" };

const PAGES = [
  {
    href: "/dashboard/setup/crest",
    title: "School crest",
    text: "Printed on receipts and statements",
  },
  { href: "/dashboard/setup/levels", title: "Levels", text: "Which levels your school offers" },
  {
    href: "/dashboard/setup/classes",
    title: "Classes and streams",
    text: "Streams and class teachers",
  },
  {
    href: "/dashboard/setup/houses",
    title: "Houses and dormitories",
    text: "Houses, dormitories and beds",
  },
  { href: "/dashboard/setup/terms", title: "Terms", text: "Academic years, terms and half-terms" },
  {
    href: "/dashboard/setup/subjects",
    title: "Subjects",
    text: "Subjects, learning areas and pathways",
  },
  {
    href: "/dashboard/setup/promote",
    title: "Promote a class",
    text: "Move a class up at the end of the year",
  },
];

export default function SetupPage() {
  return (
    <Shell
      title="School setup"
      back={{ href: "/dashboard", label: "Dashboard" }}
      aside={<SignOutButton />}
    >
      <Suspense fallback={<Loading />}>
        <Menu />
      </Suspense>
    </Shell>
  );
}

async function Menu() {
  const ctx = await requireSchool();
  if (!ctx.permissions.has("structure.manage")) redirect("/dashboard");
  return (
    <ul className="flex flex-col gap-2">
      {PAGES.map((p) => (
        <li key={p.href}>
          <Link
            href={p.href}
            className="flex flex-col rounded-2xl border border-ink/10 bg-white p-4 hover:border-teal"
          >
            <span className="font-semibold text-ink">{p.title}</span>
            <span className="text-sm text-ink/60">{p.text}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
