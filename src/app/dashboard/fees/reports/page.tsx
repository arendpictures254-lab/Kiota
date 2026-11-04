import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Button, Card, Loading, Notice, Select } from "@/components/ui";
import { deps } from "@/lib/actions";
import { kes, receiptNo } from "@/lib/fees/allocation";
import { METHODS } from "@/lib/fees/payments";
import { collectedVsExpected, dailyCollection, defaulters } from "@/lib/fees/reports";
import { getFeeSetup } from "@/lib/fees/setup";
import { formatPhone } from "@/lib/phone";
import { getStructure, enabledClasses } from "@/lib/structure/service";
import { sendRemindersAction } from "../actions";
import { FeesShell, loadFeesActor, nairobi, todayIso } from "../shared";

export const metadata: Metadata = { title: "Fee reports · Kiota" };

type Props = PageProps<"/dashboard/fees/reports">;

export default function ReportsPage({ searchParams }: Props) {
  return (
    <FeesShell title="Fee reports">
      <Suspense fallback={<Loading />}>
        <Reports searchParams={searchParams} />
      </Suspense>
    </FeesShell>
  );
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

function Bar({ collected, expected }: { collected: number; expected: number }) {
  const pct = expected > 0 ? Math.round((collected / expected) * 100) : 0;
  return (
    <div className="flex items-center gap-2" aria-label={`${pct}% collected`}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/10">
        <div
          className="h-full rounded-full bg-status-paid"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className="w-10 text-right text-xs font-semibold">{pct}%</span>
    </div>
  );
}

async function Reports({ searchParams }: Pick<Props, "searchParams">) {
  const { actor } = await loadFeesActor("fees.reports");
  const sp = await searchParams;
  const view = one(sp.view) || "collected";
  const [setup, structure] = await Promise.all([
    getFeeSetup(deps, actor),
    getStructure(deps, actor),
  ]);
  const terms = setup.terms.map((t) => ({
    value: t.id,
    label: `${t.name} ${t.academicYear.name}`,
  }));
  const termId = one(sp.termId) || setup.terms[setup.terms.length - 1]?.id || "";
  const tab = (key: string, label: string) => (
    <Link
      href={`?view=${key}${termId ? `&termId=${termId}` : ""}`}
      aria-current={view === key ? "page" : undefined}
      className={`flex-1 rounded-xl px-2 py-2 text-center text-sm font-semibold ${view === key ? "bg-teal text-white" : "bg-white text-teal"}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="flex flex-col gap-5">
      <nav className="flex gap-2" aria-label="Reports">
        {tab("collected", "Collected")}
        {tab("defaulters", "Defaulters")}
        {tab("daily", "Daily")}
      </nav>
      <a
        href="/dashboard/fees/export"
        className="inline-flex h-12 items-center justify-center rounded-xl border border-teal/30 bg-white font-semibold text-teal hover:bg-egg-blue/30"
      >
        Export everything to Excel (for the auditor)
      </a>

      {view === "collected" && termId ? (
        <Collected termId={termId} terms={terms} actor={actor} />
      ) : null}
      {view === "collected" && !termId ? <Notice>Add a term in School setup first.</Notice> : null}
      {view === "defaulters" ? (
        <Defaulters
          actor={actor}
          terms={terms}
          classes={enabledClasses(structure).map((c) => ({ value: c.id, label: c.name }))}
          f={{
            termId,
            classId: one(sp.classId),
            minAmount: one(sp.minAmount),
            minDaysOverdue: one(sp.minDays),
          }}
        />
      ) : null}
      {view === "daily" ? <Daily actor={actor} date={one(sp.date) || todayIso()} /> : null}
    </div>
  );
}

type A = Awaited<ReturnType<typeof loadFeesActor>>["actor"];

async function Collected({
  termId,
  terms,
  actor,
}: {
  termId: string;
  terms: { value: string; label: string }[];
  actor: A;
}) {
  const r = await collectedVsExpected(deps, actor, termId);
  return (
    <div className="flex flex-col gap-4">
      <form method="get" className="flex items-end gap-2">
        <input type="hidden" name="view" value="collected" />
        <div className="flex-1">
          <Select label="Term" name="termId" defaultValue={termId} options={terms} />
        </div>
        <Button type="submit" variant="secondary" className="w-24">
          Show
        </Button>
      </form>
      <Card className="flex flex-col gap-2">
        <h2 className="font-heading text-lg font-bold">Collected vs expected · {r.term.name}</h2>
        <p className="font-heading text-3xl font-bold text-teal">{kes(r.totals.collectedCents)}</p>
        <p className="text-sm text-ink/70">
          of {kes(r.totals.expectedCents)} expected · {kes(r.totals.outstandingCents)} outstanding
        </p>
        <Bar collected={r.totals.collectedCents} expected={r.totals.expectedCents} />
      </Card>
      {[
        ["By vote head", r.voteHeads],
        ["By class", r.classes],
      ].map(([title, rows]) => (
        <section key={title as string} className="flex flex-col gap-2">
          <h3 className="font-heading font-bold">{title as string}</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink/60">
                <th className="py-1 font-semibold">
                  {title === "By class" ? "Class" : "Vote head"}
                </th>
                <th className="py-1 text-right font-semibold">Expected</th>
                <th className="py-1 text-right font-semibold">Collected</th>
              </tr>
            </thead>
            <tbody>
              {(rows as typeof r.voteHeads).map((row) => (
                <tr key={row.id} className="border-t border-ink/10 align-top">
                  <td className="py-2">
                    {row.name}
                    <Bar collected={row.collectedCents} expected={row.expectedCents} />
                  </td>
                  <td className="py-2 text-right">{kes(row.expectedCents)}</td>
                  <td className="py-2 text-right font-semibold">{kes(row.collectedCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <p className="text-xs text-ink/60">
        Payments clear older balances first; what is left counts toward this term.
      </p>
    </div>
  );
}

async function Defaulters({
  actor,
  terms,
  classes,
  f,
}: {
  actor: A;
  terms: { value: string; label: string }[];
  classes: { value: string; label: string }[];
  f: { termId: string; classId: string; minAmount: string; minDaysOverdue: string };
}) {
  const rows = await defaulters(deps, actor, f);
  const total = rows.reduce((n, r) => n + r.balanceCents, 0);
  return (
    <div className="flex flex-col gap-4">
      <form
        method="get"
        className="flex flex-col gap-3 rounded-2xl border border-ink/10 bg-white p-4"
      >
        <input type="hidden" name="view" value="defaulters" />
        <Select
          label="Term (for days overdue)"
          name="termId"
          defaultValue={f.termId}
          options={terms}
        />
        <Select
          label="Class"
          name="classId"
          defaultValue={f.classId}
          placeholder="All classes"
          options={classes}
        />
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="minAmount" className="text-sm font-semibold">
              Owing at least (KES)
            </label>
            <input
              id="minAmount"
              name="minAmount"
              defaultValue={f.minAmount}
              inputMode="decimal"
              className="h-12 rounded-xl border border-ink/20 px-4"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="minDays" className="text-sm font-semibold">
              Days overdue
            </label>
            <input
              id="minDays"
              name="minDays"
              defaultValue={f.minDaysOverdue}
              inputMode="numeric"
              className="h-12 rounded-xl border border-ink/20 px-4"
            />
          </div>
        </div>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>
      <p className="text-sm text-ink/70">
        {rows.length} student{rows.length === 1 ? "" : "s"} owe {kes(total)}.
      </p>
      {rows.length ? (
        <ActionForm
          action={sendRemindersAction}
          submitLabel="Send reminder to selected parents"
          variant="secondary"
        >
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <li key={r.studentId}>
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-ink/10 bg-white p-3">
                  <input
                    type="checkbox"
                    name="studentId"
                    value={r.studentId}
                    defaultChecked
                    className="mt-1 size-5 accent-teal"
                  />
                  <span className="flex-1">
                    <span className="font-semibold">{r.name}</span>
                    <span className="block text-sm text-ink/60">
                      {r.admissionNumber} · {r.className}
                      {r.guardians[0]
                        ? ` · ${r.guardians[0].name} ${formatPhone(r.guardians[0].phone)}`
                        : " · no fee contact"}
                    </span>
                    {r.daysOverdue ? (
                      <span className="text-sm font-semibold text-status-overdue">
                        {r.daysOverdue} days overdue
                      </span>
                    ) : null}
                  </span>
                  <span className="font-heading font-bold text-status-overdue">
                    {kes(r.balanceCents)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </ActionForm>
      ) : null}
    </div>
  );
}

async function Daily({ actor, date }: { actor: A; date: string }) {
  const r = await dailyCollection(deps, actor, date);
  return (
    <div className="flex flex-col gap-4">
      <form method="get" className="flex items-end gap-2">
        <input type="hidden" name="view" value="daily" />
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="date" className="text-sm font-semibold">
            Day
          </label>
          <input
            id="date"
            name="date"
            type="date"
            defaultValue={r.date}
            className="h-12 rounded-xl border border-ink/20 px-4"
          />
        </div>
        <Button type="submit" variant="secondary" className="w-24">
          Show
        </Button>
      </form>
      <Card className="flex flex-col gap-1">
        <h2 className="font-heading text-lg font-bold">Daily collection · {r.date}</h2>
        <p className="font-heading text-3xl font-bold text-teal">{kes(r.netCents)}</p>
        <p className="text-sm text-ink/70">
          Received {kes(r.receivedCents)}
          {r.reversedCents ? `, reversed ${kes(r.reversedCents)}` : ""}
        </p>
        <ul className="mt-2 text-sm">
          {r.byMethod.map((m) => (
            <li key={m.method} className="flex justify-between">
              <span>{METHODS.find((x) => x.value === m.method)?.label}</span>
              <span>{kes(m.amountCents)}</span>
            </li>
          ))}
        </ul>
      </Card>
      <ul className="flex flex-col gap-2">
        {r.payments.map((p) => (
          <li key={p.id}>
            <Link
              href={`/dashboard/fees/receipts/${p.receiptId}`}
              className="flex justify-between gap-3 rounded-2xl border border-ink/10 bg-white p-3 text-sm hover:border-teal"
            >
              <span>
                No. {p.receiptNumber ? receiptNo(p.receiptNumber) : "—"} ·{" "}
                {p.student ? `${p.student.firstName} ${p.student.lastName}` : ""}
                <span className="block text-ink/60">
                  {METHODS.find((x) => x.value === p.method)?.label} {p.reference ?? ""} ·{" "}
                  {nairobi(p.time)}
                </span>
              </span>
              <span
                className={`font-semibold ${p.reversed ? "text-status-overdue line-through" : ""}`}
              >
                {kes(p.amountCents)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
