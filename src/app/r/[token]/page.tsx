import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PrintButton } from "@/components/print-button";
import { ReceiptSheet } from "@/components/receipt-sheet";
import { Loading } from "@/components/ui";
import { platformDb } from "@/lib/db";
import { getPublicReceipt, schoolCrest } from "@/lib/fees/receipts";
import { APP_URL } from "@/lib/hosts";

export const metadata: Metadata = {
  title: "Receipt",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** Public receipt behind an unguessable share link (sent to parents by SMS/WhatsApp). */
export default function PublicReceiptPage({ params }: PageProps<"/r/[token]">) {
  return (
    <main className="flex flex-1 flex-col items-center gap-4 bg-cream px-3 py-6">
      <Suspense fallback={<Loading />}>
        <Receipt params={params} />
      </Suspense>
    </main>
  );
}

async function Receipt({ params }: Pick<PageProps<"/r/[token]">, "params">) {
  const { token } = await params;
  const r = await getPublicReceipt(platformDb, token);
  if (!r) notFound();
  const crest = await schoolCrest(r.school.logoKey, r.school.id);
  return (
    <>
      <div className="w-full max-w-md overflow-x-auto rounded-2xl bg-white shadow-sm">
        <ReceiptSheet
          r={r}
          layout="thermal"
          crestDataUrl={
            crest ? `data:${crest.contentType};base64,${crest.bytes.toString("base64")}` : null
          }
          shareUrl={`${APP_URL.replace(/^https?:\/\//, "")}/r/${token}`}
        />
      </div>
      <div className="flex w-full max-w-md flex-col gap-2 print:hidden">
        <PrintButton label="Print or save as PDF" />
        <a
          href={`/r/${token}/pdf`}
          className="inline-flex h-12 items-center justify-center rounded-xl border border-teal/30 bg-white font-semibold text-teal"
        >
          Download PDF
        </a>
      </div>
    </>
  );
}
