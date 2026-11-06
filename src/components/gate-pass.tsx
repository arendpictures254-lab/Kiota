/**
 * The leave-out gate pass: printable on A5 (staff) and shown on a phone (parent portal). Brand
 * rule: the school's name and crest lead; Kiota appears small as "Powered by kiota". The QR code
 * holds only the signed pass token, never student details.
 */
export type GatePassView = {
  schoolName: string;
  crestDataUrl: string | null;
  studentName: string;
  classLabel: string;
  admissionNumber: string;
  photoUrl: string | null;
  leave: string;
  back: string;
  collector: string;
  approvedBy: string | null;
  reason: string;
  qrSvg: string;
  labels?: Partial<
    Record<"leaves" | "back" | "collector" | "approvedBy" | "reason" | "title", string>
  >;
};

export function GatePass({ p }: { p: GatePassView }) {
  const L = {
    title: "Leave-out pass",
    leaves: "Leaves",
    back: "Back by",
    collector: "Collected by",
    approvedBy: "Approved by",
    reason: "Reason",
    ...p.labels,
  };
  return (
    <article className="gate-pass mx-auto flex w-full max-w-[148mm] flex-col gap-3 rounded-2xl border border-ink/15 bg-white p-5 text-ink print:rounded-none print:border-0 print:p-0">
      <header className="flex items-center gap-3 border-b border-ink/10 pb-3">
        {p.crestDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- inline crest
          <img src={p.crestDataUrl} alt="" className="h-12 w-12 object-contain" />
        ) : null}
        <div className="flex flex-col">
          <span className="font-heading text-lg font-bold uppercase">{p.schoolName}</span>
          <span className="text-sm font-semibold text-teal">{L.title}</span>
        </div>
      </header>
      <div className="flex gap-4">
        {p.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- private photo, checked per request
          <img
            src={p.photoUrl}
            alt={p.studentName}
            className="h-36 w-28 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <div className="flex h-36 w-28 shrink-0 items-center justify-center rounded-lg bg-egg-blue/40 text-center text-xs text-ink/60">
            No photo on file
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-heading text-xl leading-tight font-bold">{p.studentName}</span>
          <span className="text-sm">{p.classLabel}</span>
          <span className="text-sm text-ink/70">{p.admissionNumber}</span>
          <span className="mt-1 text-xs text-ink/60">{L.reason}</span>
          <span className="text-sm">{p.reason}</span>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink/60">{L.leaves}</dt>
        <dd className="font-semibold">{p.leave}</dd>
        <dt className="text-ink/60">{L.back}</dt>
        <dd className="font-semibold">{p.back}</dd>
        <dt className="text-ink/60">{L.collector}</dt>
        <dd>{p.collector}</dd>
        {p.approvedBy ? (
          <>
            <dt className="text-ink/60">{L.approvedBy}</dt>
            <dd>{p.approvedBy}</dd>
          </>
        ) : null}
      </dl>
      <div
        className="mx-auto w-[60mm] max-w-full [&_svg]:h-auto [&_svg]:w-full"
        data-testid="pass-qr"
        // A QR code SVG we generated ourselves from the pass token.
        dangerouslySetInnerHTML={{ __html: p.qrSvg }}
      />
      <footer className="flex items-center justify-end gap-1 text-xs text-ink/60">
        <span>Powered by</span>
        {/* eslint-disable-next-line @next/next/no-img-element -- print-friendly static logo */}
        <img src="/brand/kiota-logo-horizontal.svg" alt="kiota" className="h-4" />
      </footer>
    </article>
  );
}
