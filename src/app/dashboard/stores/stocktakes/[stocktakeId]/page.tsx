import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { DataTable } from "@/components/data-table";
import { Field, Loading, Notice } from "@/components/ui";
import { deps } from "@/lib/actions";
import { formatQty, kesExact } from "@/lib/stores/stock";
import { stocktakeDetail } from "@/lib/stores/stocktake";
import { decideStocktakeAction } from "../../actions";
import { StoresShell, loadStoresActor } from "../../shared";
import { CountForm } from "./count-form";

export const metadata: Metadata = { title: "Stock-take · Kiota" };

type Props = PageProps<"/dashboard/stores/stocktakes/[stocktakeId]">;

export default function StocktakePage({ params }: Props) {
  return (
    <StoresShell back={{ href: "/dashboard/stores/stocktakes", label: "Stock-takes" }}>
      <Suspense fallback={<Loading />}>
        <Stocktake params={params} />
      </Suspense>
    </StoresShell>
  );
}

async function Stocktake({ params }: Pick<Props, "params">) {
  const { stocktakeId } = await params;
  const { actor } = await loadStoresActor();
  if (!/^[0-9a-f-]{36}$/i.test(stocktakeId)) notFound();
  const st = await stocktakeDetail(deps, actor, stocktakeId);
  if (!st) notFound();
  const p = actor.permissions;
  const canCount = p.has("stores.adjust") || p.has("stores.issue");
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-title font-bold text-ink">Stock-take · {st.store.name}</h1>
        <p className="text-ink/70">
          Started {st.startedAt.toISOString().slice(0, 10)} · {st.lines.length} items
        </p>
      </header>
      {st.status === "counting" ? (
        canCount ? (
          <CountForm
            stocktakeId={st.id}
            lines={st.lines.map((l) => ({
              itemId: l.itemId,
              name: `${l.item.name}${l.item.size ? ` (${l.item.size})` : ""}`,
              unit: l.item.unit,
              group: l.item.category || (l.item.size ? l.item.name : "Other"),
              counted: l.countedMilli,
            }))}
          />
        ) : (
          <Notice>The storekeeper is counting.</Notice>
        )
      ) : (
        <>
          <Notice
            tone={
              st.status === "approved" ? "success" : st.status === "rejected" ? "info" : "error"
            }
          >
            {st.status === "submitted"
              ? `${st.differences} difference${st.differences === 1 ? "" : "s"} against the records, worth ${kesExact(st.totalValueCents)}. Nothing changes until it is approved.`
              : st.status === "approved"
                ? `Approved: ${st.differences} adjustment${st.differences === 1 ? "" : "s"} posted (${kesExact(st.totalValueCents)}).${st.note ? ` ${st.note}` : ""}`
                : `Rejected: nothing changed.${st.note ? ` ${st.note}` : ""}`}
          </Notice>
          <DataTable
            caption="Counted against the records"
            columns={[
              { key: "item", label: "Item" },
              { key: "expected", label: "Records", align: "right", width: "9rem" },
              { key: "counted", label: "Counted", align: "right", width: "9rem" },
              { key: "diff", label: "Difference", align: "right", width: "9rem" },
              { key: "value", label: "Value", align: "right", width: "9rem" },
            ]}
            mobile={{ title: "item", subtitle: ["expected", "counted"], value: "value" }}
            rows={st.lines
              .filter((l) => (l.countedMilli ?? 0) !== (l.expectedMilli ?? 0))
              .map((l) => {
                const diff = (l.countedMilli ?? 0) - (l.expectedMilli ?? 0);
                return {
                  id: l.id,
                  cells: {
                    item: {
                      node: `${l.item.name}${l.item.size ? ` (${l.item.size})` : ""}`,
                      sort: l.item.name,
                    },
                    expected: {
                      node: formatQty(l.expectedMilli ?? 0, l.item.unit),
                      sort: l.expectedMilli ?? 0,
                    },
                    counted: {
                      node: formatQty(l.countedMilli ?? 0, l.item.unit),
                      sort: l.countedMilli ?? 0,
                    },
                    diff: {
                      node: (
                        <span
                          className={
                            diff < 0 ? "font-semibold text-status-overdue" : "text-status-paid"
                          }
                        >
                          {formatQty(diff, l.item.unit)}
                        </span>
                      ),
                      sort: diff,
                    },
                    value: { node: kesExact(l.valueCents ?? 0), sort: l.valueCents ?? 0 },
                  },
                };
              })}
            empty="No differences: the count matches the records."
          />
          {st.status === "submitted" && p.has("stores.stocktake.approve") ? (
            <section className="flex max-w-[720px] flex-col gap-3 rounded-2xl border border-ink/10 bg-white p-4">
              <h2 className="font-heading text-section font-bold">Your decision</h2>
              <ActionForm
                action={decideStocktakeAction}
                submitLabel="Approve and post the differences"
              >
                <input type="hidden" name="stocktakeId" value={st.id} />
                <input type="hidden" name="intent" value="approve" />
                <Field label="Note (optional)" name="note" placeholder="Rats got into the maize" />
              </ActionForm>
              <ActionForm
                action={decideStocktakeAction}
                submitLabel="Reject (count again)"
                variant="secondary"
              >
                <input type="hidden" name="stocktakeId" value={st.id} />
                <input type="hidden" name="intent" value="reject" />
              </ActionForm>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
