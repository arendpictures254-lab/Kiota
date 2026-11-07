import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Button, Field, Loading, Notice, Select } from "@/components/ui";
import { deps } from "@/lib/actions";
import { withContext } from "@/lib/db-core";
import { ctxOf } from "@/lib/service-kit";
import { itemPositions } from "@/lib/stores/service";
import { kesExact } from "@/lib/stores/stock";
import { findStudentForUniform, studentUniforms } from "@/lib/stores/uniforms";
import { issueUniformAction, returnUniformAction } from "../actions";
import { StoresShell, loadStoresActor } from "../shared";

export const metadata: Metadata = { title: "Uniforms · Kiota" };

type Props = PageProps<"/dashboard/stores/uniforms">;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default function UniformsPage({ searchParams }: Props) {
  return (
    <StoresShell title="Issue uniform">
      <Suspense fallback={<Loading />}>
        <Uniforms searchParams={searchParams} />
      </Suspense>
    </StoresShell>
  );
}

const day = (d: Date) =>
  d.toLocaleDateString("en-KE", {
    timeZone: "Africa/Nairobi",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/**
 * Find the student, see what they already have, issue (charged to fees or paid separately),
 * and return or exchange.
 */
async function Uniforms({ searchParams }: Pick<Props, "searchParams">) {
  const { actor } = await loadStoresActor();
  if (!actor.permissions.has("stores.issue"))
    return <Notice tone="error">Issuing uniforms is for the storekeeper.</Notice>;
  const adm = one((await searchParams).adm);
  const student = adm ? await findStudentForUniform(deps, actor, adm) : null;
  const [history, items] = await Promise.all([
    student ? studentUniforms(deps, actor, student.id) : null,
    withContext(deps.db, ctxOf(actor), async (tx) => {
      const rows = await tx.storeItem.findMany({
        where: { schoolId: actor.schoolId, active: true, store: { kind: "uniform" } },
        orderBy: [{ name: "asc" }, { size: "asc" }],
      });
      const pos = await itemPositions(
        tx,
        actor.schoolId,
        rows.map((r) => r.id),
      );
      return rows.map((r) => ({ ...r, onHandMilli: pos.get(r.id)?.quantityMilli ?? 0 }));
    }),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <form className="flex max-w-xl flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field
            label="Student's admission number"
            name="adm"
            defaultValue={adm}
            placeholder="BA/2025/002"
            required
          />
        </div>
        <Button type="submit" variant="secondary">
          Find
        </Button>
      </form>
      {adm && !student ? (
        <Notice tone="error">No active student with admission number {adm}.</Notice>
      ) : null}
      {student && history ? (
        <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
          <section
            className="flex flex-col gap-3 rounded-2xl border border-ink/10 bg-white p-4"
            aria-labelledby="issue"
          >
            <h2 id="issue" className="font-heading text-section font-bold">
              {student.firstName} {student.lastName}
            </h2>
            <p className="-mt-2 text-sm text-ink/60">
              {student.admissionNumber} · {student.class.name}
              {student.stream ? ` ${student.stream.name}` : ""}
            </p>
            <ActionForm action={issueUniformAction} submitLabel="Issue">
              <input type="hidden" name="studentId" value={student.id} />
              <Select
                label="Item"
                name="itemId"
                options={items.map((i) => ({
                  value: i.id,
                  label: `${i.name}${i.size ? ` (${i.size})` : ""} · ${i.priceCents !== null ? kesExact(i.priceCents) : "no price"} · ${i.onHandMilli / 1000} in stock`,
                }))}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="How many"
                  name="quantity"
                  inputMode="numeric"
                  defaultValue="1"
                  required
                />
                <Select
                  label="Payment"
                  name="payment"
                  options={[
                    { value: "charged", label: "Charge to the fee account" },
                    { value: "paid_separately", label: "Paid separately" },
                  ]}
                />
              </div>
              <Field label="Receipt or M-Pesa reference (if paid separately)" name="reference" />
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" name="again" value="1" className="size-5 accent-teal" />
                Issue again, even if they already have this item
              </label>
            </ActionForm>
          </section>
          <section
            className="flex flex-col gap-3"
            aria-labelledby="has"
            data-testid="uniform-history"
          >
            <h2 id="has" className="font-heading text-section font-bold">
              Already issued ({history.filter((h) => h.status === "issued").length})
            </h2>
            {history.length === 0 ? <p className="text-ink/60">Nothing yet.</p> : null}
            <ul className="flex flex-col gap-2">
              {history.map((h) => (
                <li
                  key={h.id}
                  className="flex flex-col gap-2 rounded-2xl border border-ink/10 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block font-semibold text-ink">
                        {h.item.name}
                        {h.item.size ? ` (${h.item.size})` : ""}
                        {h.quantity > 1 ? ` × ${h.quantity}` : ""}
                      </span>
                      <span className="block text-sm text-ink/60">
                        {day(h.issuedAt)} · {kesExact(h.totalCents)} ·{" "}
                        {h.payment === "charged" ? "charged to fees" : `paid (${h.paidReference})`}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 text-sm font-semibold ${h.status === "issued" ? "text-status-paid" : "text-ink/50"}`}
                    >
                      {h.status === "issued" ? "Issued" : "Returned"}
                    </span>
                  </div>
                  {h.status === "issued" ? (
                    <details>
                      <summary className="cursor-pointer text-sm font-semibold text-teal">
                        Return or exchange
                      </summary>
                      <ActionForm
                        action={returnUniformAction}
                        submitLabel="Return"
                        variant="secondary"
                        className="mt-3 flex flex-col gap-3"
                      >
                        <input type="hidden" name="issueId" value={h.id} />
                        <Field
                          label="Why"
                          name="reason"
                          id={`why-${h.id}`}
                          placeholder="Wrong size"
                          required
                        />
                        <Select
                          label="Exchange for (optional)"
                          name="exchangeItemId"
                          id={`ex-${h.id}`}
                          placeholder="No exchange: just return"
                          options={items
                            .filter((i) => i.name === h.item.name && i.id !== h.itemId)
                            .map((i) => ({
                              value: i.id,
                              label: `${i.name} (${i.size}) · ${i.onHandMilli / 1000} in stock`,
                            }))}
                        />
                      </ActionForm>
                    </details>
                  ) : h.returnReason ? (
                    <p className="text-sm text-ink/60">Returned: {h.returnReason}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  );
}
