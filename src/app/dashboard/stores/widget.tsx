import Link from "next/link";
import type { storesWidget } from "@/lib/stores/reports";
import { formatQty, kesWhole } from "@/lib/stores/stock";

type W = Awaited<ReturnType<typeof storesWidget>>;

/**
 * Stores on the dashboard: stock value, items below reorder level, this week's food cost per
 * student and open variance flags (the Director); the low-stock list for the storekeeper.
 */
export function StoresWidget({ w, showCost }: { w: W; showCost: boolean }) {
  return (
    <section
      className="flex min-w-0 flex-col rounded-2xl border border-ink/10 bg-white"
      aria-labelledby="stores-widget"
      data-testid="stores-widget"
    >
      <div className="flex items-center justify-between gap-2 border-b border-ink/10 px-4 py-3 lg:px-5">
        <h2 id="stores-widget" className="font-heading text-section font-bold">
          Stores
        </h2>
        <Link
          href="/dashboard/stores"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-teal"
        >
          Details →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-4 lg:px-5">
        <Figure label="Stock value" value={kesWhole(w.valueCents)} />
        <Figure
          label="Below reorder level"
          value={String(w.low.length)}
          tone={w.low.length ? "text-status-overdue" : "text-ink"}
        />
        {showCost ? (
          <>
            <Figure label="Food per student this week" value={kesWhole(w.weekPerStudentCents)} />
            <Link href="/dashboard/stores/reports" className="flex flex-col">
              <span className="text-xs text-ink/60">Open variance flags</span>
              <span
                className={`font-heading text-[clamp(1.25rem,1rem+0.6vw,1.6rem)] font-bold ${w.openVariances ? "text-status-due" : "text-ink"}`}
              >
                {w.openVariances}
              </span>
            </Link>
          </>
        ) : (
          <Figure
            label="Expiring soon"
            value={String(w.expiring.length)}
            tone={w.expiring.length ? "text-status-due" : "text-ink"}
          />
        )}
      </div>
      {w.low.length ? (
        <ul className="mx-4 mb-3 flex flex-col gap-0.5 rounded-xl bg-status-overdue/10 p-3 text-sm lg:mx-5">
          {w.low.slice(0, 5).map((l) => (
            <li key={l.id} className="flex justify-between gap-2">
              <Link href={`/dashboard/stores/items/${l.id}`} className="font-semibold text-ink">
                {l.name}
              </Link>
              <span className="text-status-overdue">{formatQty(l.onHandMilli, l.unit)}</span>
            </li>
          ))}
          {w.low.length > 5 ? <li className="text-ink/60">and {w.low.length - 5} more</li> : null}
        </ul>
      ) : null}
    </section>
  );
}

function Figure({
  label,
  value,
  tone = "text-ink",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-xs text-ink/60">{label}</span>
      <span
        className={`truncate font-heading text-[clamp(1.25rem,1rem+0.6vw,1.6rem)] font-bold ${tone}`}
      >
        {value}
      </span>
    </div>
  );
}
