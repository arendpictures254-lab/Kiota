import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Button, Loading } from "@/components/ui";
import { deps } from "@/lib/actions";
import { withContext } from "@/lib/db-core";
import { kes, receiptNo } from "@/lib/fees/allocation";
import { METHODS } from "@/lib/fees/payments";
import { clean, ctxOf } from "@/lib/service-kit";
import { FeesShell, loadFeesActor, nairobi } from "../shared";

export const metadata: Metadata = { title: "Payments and receipts · Kiota" };

export default function PaymentsPage({ searchParams }: PageProps<"/dashboard/fees/payments">) {
  return (
    <FeesShell title="Payments and receipts">
      <Suspense fallback={<Loading />}>
        <Payments searchParams={searchParams} />
      </Suspense>
    </FeesShell>
  );
}

async function Payments({
  searchParams,
}: Pick<PageProps<"/dashboard/fees/payments">, "searchParams">) {
  const { actor } = await loadFeesActor("fees.view", "fees.collect");
  const sp = await searchParams;
  const q = clean(typeof sp.q === "string" ? sp.q : "");
  const rows = await withContext(deps.db, ctxOf(actor), async (tx) => {
    const n = q && /^\d{1,6}$/.test(q) ? Number(q) : null;
    const students = q
      ? await tx.student.findMany({
          where: {
            schoolId: actor.schoolId,
            OR: [
              { admissionNumber: { contains: q, mode: "insensitive" } },
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
            ],
          },
          select: { id: true },
          take: 200,
        })
      : [];
    const payments = await tx.payment.findMany({
      where: q
        ? {
            schoolId: actor.schoolId,
            OR: [
              { reference: { contains: q, mode: "insensitive" } },
              { studentId: { in: students.map((s) => s.id) } },
              ...(n ? [{ receipt: { number: n } }] : []),
            ],
          }
        : { schoolId: actor.schoolId },
      include: { receipt: true, reversal: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const names = await tx.student.findMany({
      where: { schoolId: actor.schoolId, id: { in: payments.map((p) => p.studentId) } },
      select: { id: true, firstName: true, lastName: true, admissionNumber: true },
    });
    return payments.map((p) => ({ ...p, student: names.find((s) => s.id === p.studentId) }));
  });

  return (
    <div className="flex flex-col gap-4">
      <form
        method="get"
        role="search"
        className="flex flex-col gap-2 rounded-2xl border border-ink/10 bg-white p-4"
      >
        <label htmlFor="q" className="text-sm font-semibold">
          Search
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q ?? ""}
          placeholder="Receipt no., admission no., name or M-Pesa code"
          className="h-12 rounded-xl border border-ink/20 px-4"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      {rows.length === 0 ? <p className="text-ink/60">No payments found.</p> : null}
      <ul className="flex flex-col gap-2">
        {rows.map((p) => (
          <li key={p.id}>
            <Link
              href={`/dashboard/fees/receipts/${p.receipt?.id}`}
              className="flex items-start justify-between gap-3 rounded-2xl border border-ink/10 bg-white p-4 hover:border-teal"
            >
              <span className="flex flex-col">
                <span className="font-semibold">
                  {p.student ? `${p.student.firstName} ${p.student.lastName}` : "Student"}
                </span>
                <span className="text-sm text-ink/60">
                  No. {p.receipt ? receiptNo(p.receipt.number) : "—"} ·{" "}
                  {METHODS.find((m) => m.value === p.method)?.label}
                  {p.reference ? ` ${p.reference}` : ""} · {nairobi(p.createdAt)}
                </span>
              </span>
              <span className="text-right">
                <span
                  className={`block font-semibold ${p.reversal ? "text-status-overdue line-through" : "text-ink"}`}
                >
                  {kes(p.amountCents)}
                </span>
                {p.reversal ? (
                  <span className="text-xs font-semibold text-status-overdue">Reversed</span>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
