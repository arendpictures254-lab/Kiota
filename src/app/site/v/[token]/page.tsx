import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { verifyReportCard } from "@/lib/academics/reportcards";
import { platformDb } from "@/lib/db";

export const metadata: Metadata = {
  title: "Report card check · Kiota",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** Unknown codes get their real 404 from src/proxy.ts before this renders (see /r/[token]). */
export const instant = false;

const day = (d: Date) =>
  d.toLocaleDateString("en-KE", {
    timeZone: "Africa/Nairobi",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/**
 * kiota.app/v/<code>, from the QR code on a released report card. It confirms the card is
 * genuine and shows four facts only: the school, the student's name, the term and the release
 * date. Never marks, grades or anything else: compare them with the paper.
 */
export default async function VerifyPage({ params }: PageProps<"/site/v/[token]">) {
  const { token } = await params;
  const v = await verifyReportCard(platformDb, token);
  if (!v) notFound();
  return (
    <section className="mx-auto flex w-full max-w-[640px] flex-col gap-5 px-4 py-12">
      <p className="inline-flex w-fit items-center gap-2 rounded-full bg-status-paid/15 px-4 py-1.5 text-sm font-bold text-status-paid">
        <span aria-hidden>✓</span> Genuine report card
      </p>
      <h1 className="text-title font-bold">This report card was issued by {v.school}</h1>
      <dl
        className="grid grid-cols-1 gap-3 rounded-2xl border border-ink/10 bg-white p-5 sm:grid-cols-2"
        data-testid="verified"
      >
        {[
          ["School", v.school],
          ["Student", v.student],
          ["Term", v.term],
          ["Released", day(v.releasedAt)],
        ].map(([k, val]) => (
          <div key={k} className="min-w-0">
            <dt className="text-sm text-ink/60">{k}</dt>
            <dd className="text-lg font-semibold [overflow-wrap:anywhere]">{val}</dd>
          </div>
        ))}
      </dl>
      <p className="text-ink/70">
        Kiota shows only these details. Check that the name and term match the paper. If marks look
        altered, ask the school for its copy.
      </p>
    </section>
  );
}
