import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ButtonLink, Loading } from "@/components/ui";
import { deps } from "@/lib/actions";
import { isoDay } from "@/lib/attendance/rules";
import { storeAlerts } from "@/lib/stores/reports";
import { listStores } from "@/lib/stores/service";
import { formatQty, kesExact } from "@/lib/stores/stock";
import { StoresShell, loadStoresActor } from "./shared";

export const metadata: Metadata = { title: "Stores · Kiota" };

export default function StoresPage() {
  return (
    <StoresShell title="Stores" back={{ href: "/dashboard", label: "Dashboard" }}>
      <Suspense fallback={<Loading />}>
        <Hub />
      </Suspense>
    </StoresShell>
  );
}

async function Hub() {
  const { actor } = await loadStoresActor();
  const p = actor.permissions;
  const [stores, alerts] = await Promise.all([listStores(deps, actor), storeAlerts(deps, actor)]);
  const total = stores.reduce((n, s) => n + s.valueCents, 0);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {p.has("stores.issue") ? (
          <ButtonLink href="/dashboard/stores/meals">Issue for a meal</ButtonLink>
        ) : null}
        {p.has("stores.receive") ? (
          <ButtonLink href="/dashboard/stores/receive" variant="secondary">
            Receive stock
          </ButtonLink>
        ) : null}
        {p.has("stores.issue") ? (
          <ButtonLink href="/dashboard/stores/uniforms" variant="secondary">
            Issue uniform
          </ButtonLink>
        ) : null}
        <ButtonLink href="/dashboard/stores/stocktakes" variant="secondary">
          Stock-takes
        </ButtonLink>
        {p.has("stores.reports") || p.has("stores.stocktake.approve") ? (
          <ButtonLink href="/dashboard/stores/reports" variant="secondary">
            Reports
          </ButtonLink>
        ) : null}
        {p.has("stores.setup") ? (
          <ButtonLink href="/dashboard/stores/setup" variant="secondary">
            Setup
          </ButtonLink>
        ) : null}
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="stores">
        <h2 id="stores" className="font-heading text-section font-bold">
          Stores ·{" "}
          <span className="font-sans text-base font-normal text-ink/70">
            {kesExact(total)} in stock
          </span>
        </h2>
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-4 [&>li]:min-w-0 [&>li>*]:h-full">
          {stores.map((s) => (
            <li key={s.id}>
              <Link
                href={`/dashboard/stores/${s.id}`}
                className="flex flex-col gap-1 rounded-2xl border border-ink/10 bg-white p-4 hover:border-teal/40"
              >
                <span className="font-semibold text-ink">{s.name}</span>
                <span className="text-sm text-ink/60">
                  {s.items} item{s.items === 1 ? "" : "s"} · {kesExact(s.valueCents)}
                </span>
                {s.low ? (
                  <span className="text-sm font-semibold text-status-overdue">
                    {s.low} below reorder level
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section
          className="flex min-w-0 flex-col gap-2 rounded-2xl border border-ink/10 bg-white p-4"
          aria-labelledby="low"
          data-testid="low-stock"
        >
          <h2 id="low" className="font-heading text-section font-bold">
            Below reorder level ({alerts.low.length})
          </h2>
          {alerts.low.length === 0 ? <p className="text-sm text-ink/60">Nothing is low.</p> : null}
          <ul className="flex flex-col divide-y divide-ink/5">
            {alerts.low.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/dashboard/stores/items/${l.id}`}
                  className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="font-semibold text-ink">{l.name}</span>
                    <span className="block text-ink/60">{l.store}</span>
                  </span>
                  <span className="shrink-0 text-right font-semibold text-status-overdue">
                    {formatQty(l.onHandMilli, l.unit)}
                    <span className="block text-xs font-normal text-ink/60">
                      reorder at {formatQty(l.reorderLevelMilli, l.unit)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section
          className="flex min-w-0 flex-col gap-2 rounded-2xl border border-ink/10 bg-white p-4"
          aria-labelledby="exp"
        >
          <h2 id="exp" className="font-heading text-section font-bold">
            Expiring soon ({alerts.expiring.length})
          </h2>
          {alerts.expiring.length === 0 ? (
            <p className="text-sm text-ink/60">Nothing expires in the next two weeks.</p>
          ) : null}
          <ul className="flex flex-col divide-y divide-ink/5">
            {alerts.expiring.map((e) => (
              <li
                key={e.id}
                className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-semibold text-ink">{e.name}</span>
                  <span className="block text-ink/60">
                    {e.store} · {formatQty(e.remainingMilli, e.unit)} from that delivery
                  </span>
                </span>
                <span
                  className={`shrink-0 font-semibold ${e.expired ? "text-status-overdue" : "text-status-due"}`}
                >
                  {e.expired ? "Expired " : ""}
                  {isoDay(e.expiryDate)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
