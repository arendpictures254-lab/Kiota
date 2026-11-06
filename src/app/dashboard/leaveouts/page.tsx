import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ButtonLink, Loading } from "@/components/ui";
import { deps } from "@/lib/actions";
import { whenText } from "@/lib/leaveout/rules";
import {
  canApproveLeaveouts,
  canManageBoarding,
  canRequestLeaveouts,
  leaveoutLists,
} from "@/lib/leaveout/service";
import { LeaveoutsShell, StatusPill, loadLeaveoutActor } from "./shared";

export const metadata: Metadata = { title: "Leave-outs · Kiota" };

export default function LeaveoutsPage() {
  return (
    <LeaveoutsShell title="Leave-outs" back={{ href: "/dashboard", label: "Dashboard" }}>
      <Suspense fallback={<Loading />}>
        <Hub />
      </Suspense>
    </LeaveoutsShell>
  );
}

type Row = Awaited<ReturnType<typeof leaveoutLists>>["waiting"][number];

function Item({ l, right }: { l: Row; right?: React.ReactNode }) {
  return (
    <li>
      <Link
        href={`/dashboard/leaveouts/${l.id}`}
        className="flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-ink/10 bg-white p-4 hover:border-teal/40"
      >
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold text-ink">{l.studentName}</span>
          <span className="truncate text-sm text-ink/60">
            {l.classLabel} · {l.reason} · {l.collectorName} ({l.collectorRelationship})
          </span>
          <span className="text-sm text-ink/60">
            {whenText(l.leaveAt)} → {whenText(l.returnAt)}
          </span>
        </span>
        <span className="shrink-0">{right ?? <StatusPill status={l.status} />}</span>
      </Link>
    </li>
  );
}

async function Hub() {
  const { actor } = await loadLeaveoutActor();
  const lists = await leaveoutLists(deps, actor);
  const p = actor.permissions;
  return (
    <div className="flex flex-col gap-6">
      {canRequestLeaveouts(p) ? (
        <ButtonLink href="/dashboard/leaveouts/new">Request a leave-out</ButtonLink>
      ) : null}

      <section className="flex flex-col gap-2" aria-labelledby="waiting">
        <h2 id="waiting" className="font-heading text-lg font-bold">
          Waiting ({lists.waiting.length})
        </h2>
        {lists.waiting.length === 0 ? (
          <p className="text-ink/60">Nothing waiting.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {lists.waiting.map((l) => (
              <Item key={l.id} l={l} />
            ))}
          </ul>
        )}
        {lists.waiting.length && !canApproveLeaveouts(p) ? (
          <p className="text-sm text-ink/60">
            Staff the Director has allowed to approve will decide.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="out">
        <h2 id="out" className="font-heading text-lg font-bold">
          Out now ({lists.out.length})
        </h2>
        {lists.out.length === 0 ? (
          <p className="text-ink/60">Every student is in school.</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="out-board">
            {lists.out.map((l) => (
              <Item
                key={l.id}
                l={l}
                right={
                  l.overdue ? (
                    <span className="rounded-full bg-status-overdue px-2 py-0.5 text-xs font-bold text-white">
                      Late back
                    </span>
                  ) : (
                    <span className="text-sm text-ink/60">Back {whenText(l.returnAt)}</span>
                  )
                }
              />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="soon">
        <h2 id="soon" className="font-heading text-lg font-bold">
          Passes for today and tomorrow ({lists.upcoming.length})
        </h2>
        {lists.upcoming.length === 0 ? (
          <p className="text-ink/60">No approved passes.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {lists.upcoming.map((l) => (
              <Item key={l.id} l={l} />
            ))}
          </ul>
        )}
      </section>

      <nav className="flex flex-col gap-2">
        {canApproveLeaveouts(p) ? (
          <ButtonLink href="/dashboard/leaveouts/half-term" variant="secondary">
            Half term: passes for a class or all boarders
          </ButtonLink>
        ) : null}
        {canManageBoarding(p) ? (
          <ButtonLink href="/dashboard/leaveouts/reports" variant="secondary">
            Reports
          </ButtonLink>
        ) : null}
        {p.has("gate.scan") ? (
          <ButtonLink href="/gate" variant="secondary">
            Gate scanner
          </ButtonLink>
        ) : null}
      </nav>
    </div>
  );
}
