import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { ButtonLink, Card, Field, Loading, Select } from "@/components/ui";
import { deps } from "@/lib/actions";
import { kes } from "@/lib/fees/allocation";
import { getFeeSetup } from "@/lib/fees/setup";
import {
  addBursaryAction,
  addDiscountAction,
  addFeeItemAction,
  addVoteHeadAction,
  defaultVoteHeadsAction,
  endBursaryAction,
  moveVoteHeadAction,
  toggleDiscountAction,
} from "../actions";
import { FeesShell, loadFeesActor } from "../shared";

export const metadata: Metadata = { title: "Fee setup · Kiota" };

export default function FeeSetupPage() {
  return (
    <FeesShell title="Fee setup">
      <Suspense fallback={<Loading />}>
        <Setup />
      </Suspense>
    </FeesShell>
  );
}

function Section({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-xl font-bold">{title}</h2>
      {intro ? <p className="text-sm text-ink/70">{intro}</p> : null}
      {children}
    </section>
  );
}

async function Setup() {
  const { actor } = await loadFeesActor("fees.setup");
  const s = await getFeeSetup(deps, actor);
  const vhOptions = s.voteHeads.map((v) => ({ value: v.id, label: v.name }));

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Vote heads"
        intro="Payments go to vote heads in this order: the top one is paid first. Opening balances go to Arrears."
      >
        {s.voteHeads.length === 0 ? (
          <ActionForm
            action={defaultVoteHeadsAction}
            submitLabel="Set up the usual Kenyan vote heads"
          >
            <p className="text-sm text-ink/70">
              Arrears, Tuition, Boarding, Activity, Transport, Uniform, Exam and Development. You
              can add your own after.
            </p>
          </ActionForm>
        ) : (
          <ol className="flex flex-col gap-2">
            {s.voteHeads.map((v, i) => (
              <li
                key={v.id}
                className="flex items-center gap-3 rounded-2xl border border-ink/10 bg-white p-3"
              >
                <span className="w-6 text-center font-heading font-bold text-teal">{i + 1}</span>
                <span className="flex-1 font-semibold">
                  {v.name}
                  {v.isArrears ? (
                    <span className="ml-2 text-xs font-normal text-ink/60">(opening balances)</span>
                  ) : null}
                </span>
                <ActionForm
                  action={moveVoteHeadAction}
                  submitLabel="↑"
                  variant="secondary"
                  className="w-12"
                >
                  <input type="hidden" name="voteHeadId" value={v.id} />
                  <input type="hidden" name="direction" value="up" />
                </ActionForm>
                <ActionForm
                  action={moveVoteHeadAction}
                  submitLabel="↓"
                  variant="secondary"
                  className="w-12"
                >
                  <input type="hidden" name="voteHeadId" value={v.id} />
                  <input type="hidden" name="direction" value="down" />
                </ActionForm>
              </li>
            ))}
          </ol>
        )}
        {s.voteHeads.length ? (
          <ActionForm action={addVoteHeadAction} submitLabel="Add vote head" variant="secondary">
            <Field label="New vote head" name="name" id="vh-name" placeholder="Library" required />
          </ActionForm>
        ) : null}
      </Section>

      {s.voteHeads.length ? (
        <Section title="Fee items" intro="What appears on invoices. Each belongs to a vote head.">
          <ul className="flex flex-wrap gap-2">
            {s.feeItems.map((i) => (
              <li key={i.id} className="rounded-full bg-white px-3 py-1 text-sm">
                {i.name} <span className="text-ink/50">· {i.voteHead.name}</span>
              </li>
            ))}
          </ul>
          <ActionForm action={addFeeItemAction} submitLabel="Add fee item" variant="secondary">
            <Field
              label="Fee item"
              name="name"
              id="item-name"
              placeholder="Computer lab fee"
              required
            />
            <Select label="Vote head" name="voteHeadId" options={vhOptions} />
          </ActionForm>
        </Section>
      ) : null}

      <Section
        title="Fee structures"
        intro="What each level pays per term, as a boarder or day scholar, with the instalment dates."
      >
        {s.structures.map((st) => {
          const total = st.lines.reduce((n, l) => n + l.amountCents, 0);
          return (
            <Link
              key={st.id}
              href={`/dashboard/fees/setup/structure?termId=${st.termId}&levelId=${st.levelId}&appliesTo=${st.appliesTo}`}
              className="flex items-center justify-between gap-3 rounded-2xl border border-ink/10 bg-white p-4 hover:border-teal"
            >
              <span>
                <span className="font-semibold">
                  {st.level.name}, {st.appliesTo === "boarder" ? "boarders" : "day scholars"}
                </span>
                <span className="block text-sm text-ink/60">
                  {st.term.name} {st.term.academicYear.name} · {st.installments.length || "no"}{" "}
                  instalment{st.installments.length === 1 ? "" : "s"}
                </span>
              </span>
              <span className="font-heading font-bold text-teal">{kes(total)}</span>
            </Link>
          );
        })}
        {s.voteHeads.length && s.terms.length ? (
          <ButtonLink href="/dashboard/fees/setup/structure" variant="secondary">
            Add a fee structure
          </ButtonLink>
        ) : (
          <p className="text-sm text-ink/60">
            Set up vote heads, and add terms in School setup, first.
          </p>
        )}
      </Section>

      {s.voteHeads.length ? (
        <Section
          title="Sibling discounts"
          intro="Applied automatically when term invoices are generated. Siblings share a guardian; the oldest is the 1st child."
        >
          {s.discounts.map((d) => (
            <Card key={d.id} className="flex items-center justify-between gap-3 py-3">
              <span>
                <span className="font-semibold">{d.name}</span>
                <span className="block text-sm text-ink/60">
                  {d.percentBp / 100}% off {d.voteHead.name} from the {ordinal(d.siblingPosition)}{" "}
                  child · {d.active ? "On" : "Off"}
                </span>
              </span>
              <ActionForm
                action={toggleDiscountAction}
                submitLabel={d.active ? "Turn off" : "Turn on"}
                variant="secondary"
                className="w-28"
              >
                <input type="hidden" name="ruleId" value={d.id} />
                <input type="hidden" name="active" value={d.active ? "0" : "1"} />
              </ActionForm>
            </Card>
          ))}
          <ActionForm
            action={addDiscountAction}
            submitLabel="Add sibling discount"
            variant="secondary"
          >
            <Field label="Name" name="name" id="disc-name" placeholder="Second child" required />
            <Select
              label="From which child"
              name="siblingPosition"
              options={[2, 3, 4, 5].map((n) => ({
                value: String(n),
                label: `${ordinal(n)} child and after`,
              }))}
            />
            <Field
              label="Discount (%)"
              name="percent"
              inputMode="decimal"
              placeholder="10"
              required
            />
            <Select label="On which vote head" name="voteHeadId" options={vhOptions} />
          </ActionForm>
        </Section>
      ) : null}

      {s.voteHeads.length ? (
        <Section
          title="Bursaries and scholarships"
          intro="Credited when term invoices are generated, with the sponsor recorded."
        >
          {s.bursaries.map((b) => {
            const st = s.students.find((x) => x.id === b.studentId);
            return (
              <Card key={b.id} className="flex items-center justify-between gap-3 py-3">
                <span>
                  <span className="font-semibold">
                    {st ? `${st.firstName} ${st.lastName} (${st.admissionNumber})` : "Student"}
                  </span>
                  <span className="block text-sm text-ink/60">
                    {b.kind === "scholarship" ? "Scholarship" : "Bursary"} from {b.sponsorName}:{" "}
                    {b.coverage === "full"
                      ? "full fees"
                      : b.coverage === "percent"
                        ? `${(b.percentBp ?? 0) / 100}%`
                        : kes(b.amountCents ?? 0)}
                    {b.termId
                      ? ` · ${s.terms.find((t) => t.id === b.termId)?.name ?? ""}`
                      : " · every term"}
                  </span>
                </span>
                <ActionForm
                  action={endBursaryAction}
                  submitLabel="End"
                  variant="danger"
                  className="w-20"
                >
                  <input type="hidden" name="bursaryId" value={b.id} />
                </ActionForm>
              </Card>
            );
          })}
          <ActionForm
            action={addBursaryAction}
            submitLabel="Add bursary or scholarship"
            variant="secondary"
          >
            <Field
              label="Student's admission number"
              name="admissionNumber"
              id="bur-adm"
              required
            />
            <Select
              label="Kind"
              name="kind"
              options={[
                { value: "bursary", label: "Bursary" },
                { value: "scholarship", label: "Scholarship" },
              ]}
            />
            <Field
              label="Sponsor"
              name="sponsorName"
              placeholder="Kilifi County Bursary Fund"
              required
            />
            <Select
              label="Covers"
              name="coverage"
              options={[
                { value: "percent", label: "A percentage" },
                { value: "amount", label: "A fixed amount" },
                { value: "full", label: "Full fees" },
              ]}
            />
            <Field
              label="Percentage"
              name="percent"
              id="bur-pct"
              inputMode="decimal"
              hint="For a percentage bursary"
            />
            <Field
              label="Amount (KES)"
              name="amount"
              id="bur-amt"
              inputMode="decimal"
              hint="For a fixed amount"
            />
            <Select
              label="Term"
              name="termId"
              placeholder="Every term"
              options={s.terms.map((t) => ({
                value: t.id,
                label: `${t.name} ${t.academicYear.name}`,
              }))}
            />
            <Select
              label="Vote head"
              name="voteHeadId"
              placeholder="All fees"
              options={vhOptions}
            />
          </ActionForm>
        </Section>
      ) : null}
    </div>
  );
}

function ordinal(n: number) {
  return `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
}
