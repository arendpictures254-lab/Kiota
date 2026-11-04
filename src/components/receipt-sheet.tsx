/**
 * A printable receipt (HTML). Brand rule: the school's name and crest lead; Kiota appears small
 * as "Powered by kiota". "thermal" is 80 mm wide, black only; "a4" is a full page.
 */
import { kes, receiptNo } from "@/lib/fees/allocation";
import type { ReceiptView } from "@/lib/fees/receipts";

const when = (d: Date) =>
  d.toLocaleString("en-KE", {
    timeZone: "Africa/Nairobi",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const day = (d: Date) =>
  d.toLocaleDateString("en-KE", {
    timeZone: "Africa/Nairobi",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span>{label}</span>
      <span className={`text-right ${strong ? "font-bold" : ""}`}>{value}</span>
    </div>
  );
}

export function ReceiptSheet({
  r,
  layout,
  crestDataUrl,
  shareUrl,
}: {
  r: ReceiptView;
  layout: "thermal" | "a4";
  crestDataUrl: string | null;
  shareUrl: string | null;
}) {
  const thermal = layout === "thermal";
  return (
    <article
      data-layout={layout}
      aria-label={`Receipt ${receiptNo(r.number)}`}
      className={
        thermal
          ? "receipt-thermal mx-auto w-[72mm] bg-white p-3 font-sans text-[12px] leading-snug text-black"
          : "receipt-a4 mx-auto w-full max-w-[190mm] bg-white p-8 text-ink"
      }
    >
      <style>{`
        @media print {
          @page { size: ${thermal ? "80mm auto" : "A4"}; margin: ${thermal ? "0" : "15mm"}; }
          body { background: white !important; }
        }
      `}</style>
      <header className={thermal ? "text-center" : "flex items-start justify-between gap-6"}>
        <div className={thermal ? "flex flex-col items-center gap-1" : "flex items-center gap-4"}>
          {crestDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- inline crest
            <img
              src={crestDataUrl}
              alt=""
              className={thermal ? "size-14 object-contain grayscale" : "size-16 object-contain"}
            />
          ) : null}
          <div>
            <p
              className={`font-heading font-bold ${thermal ? "text-[15px] uppercase" : "text-2xl"}`}
            >
              {r.school.name}
            </p>
            {!thermal ? <p className="text-ink/60">Official receipt</p> : null}
          </div>
        </div>
        <div className={thermal ? "mt-1" : "text-right"}>
          <p className={thermal ? "font-bold" : "font-heading text-xl font-bold text-teal"}>
            {thermal ? "Official receipt " : ""}No. {receiptNo(r.number)}
          </p>
          <p className={thermal ? "text-[11px]" : "text-sm text-ink/60"}>{when(r.issuedAt)}</p>
        </div>
      </header>

      <hr className={`my-2 border-dashed ${thermal ? "border-black" : "my-6 border-ink/15"}`} />
      <section className={thermal ? "" : "grid grid-cols-2 gap-x-8 gap-y-1"}>
        <Row label="Student" value={r.student.name} strong />
        <Row label="Adm" value={r.student.admissionNumber} />
        <Row label="Class" value={r.student.className} />
        <Row label="Date paid" value={day(r.paidAt)} />
        <Row label="Method" value={r.methodLabel} />
        {r.reference ? <Row label="Reference" value={r.reference} /> : null}
        {r.payerName ? <Row label="Paid by" value={r.payerName} /> : null}
      </section>

      {r.allocation.length ? (
        <>
          <hr className={`my-2 border-dashed ${thermal ? "border-black" : "my-6 border-ink/15"}`} />
          <section>
            {!thermal ? <p className="mb-2 text-sm font-bold">Paid towards</p> : null}
            {r.allocation.map((a, i) => (
              <Row key={i} label={a.voteHead} value={kes(a.amountCents)} />
            ))}
          </section>
        </>
      ) : null}

      <hr className={`my-2 border-dashed ${thermal ? "border-black" : "my-6 border-ink/15"}`} />
      <div className={thermal ? "" : "space-y-2"}>
        <div
          className={`flex justify-between font-heading font-bold ${thermal ? "text-[14px]" : "text-xl"}`}
        >
          <span>Paid</span>
          <span>{kes(r.amountCents)}</span>
        </div>
        <div
          className={`flex justify-between font-heading font-bold ${thermal ? "text-[14px]" : "text-3xl text-teal"}`}
        >
          <span>Balance</span>
          <span>{kes(r.balanceAfterCents)}</span>
        </div>
      </div>
      {r.servedBy ? (
        <p className={`mt-2 ${thermal ? "text-center text-[11px]" : "text-sm text-ink/60"}`}>
          Served by {r.servedBy}
        </p>
      ) : null}

      {r.reversal ? (
        <div
          className={`mt-3 border-2 p-2 text-center ${thermal ? "border-black" : "border-status-overdue text-status-overdue"}`}
        >
          <p className="font-heading text-lg font-bold">REVERSED</p>
          <p className="text-sm">{r.reversal.reason}</p>
        </div>
      ) : null}

      <footer
        className={`mt-4 ${thermal ? "text-center text-[10px]" : "flex items-end justify-between text-xs text-ink/60"}`}
      >
        {shareUrl ? (
          <p className={thermal ? "mb-2 break-all" : ""}>Check this receipt: {shareUrl}</p>
        ) : (
          <span />
        )}
        <p className={`flex items-center gap-1 ${thermal ? "flex-col" : ""}`}>
          <span>Powered by</span>
          {/* eslint-disable-next-line @next/next/no-img-element -- print-friendly static logo */}
          <img
            src={
              thermal
                ? "/brand/kiota-logo-horizontal-mono-black.svg"
                : "/brand/kiota-logo-horizontal.svg"
            }
            alt="kiota"
            className={thermal ? "w-[40mm]" : "h-5"}
          />
        </p>
      </footer>
    </article>
  );
}
