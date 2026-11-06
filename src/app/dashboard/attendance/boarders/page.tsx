import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Loading, Notice } from "@/components/ui";
import { deps } from "@/lib/actions";
import { boarderAlerts, canHandleBoarderAlerts } from "@/lib/attendance/service";
import { boarderAlertAction } from "../actions";
import { AttendanceShell, loadAttendanceActor, nairobiTime } from "../shared";

export const metadata: Metadata = { title: "Absent boarders · Kiota" };

export default function BoardersPage({
  searchParams,
}: PageProps<"/dashboard/attendance/boarders">) {
  return (
    <AttendanceShell title="Absent boarders">
      <Suspense fallback={<Loading />}>
        <Boarders searchParams={searchParams} />
      </Suspense>
    </AttendanceShell>
  );
}

const STATUS: Record<string, { text: string; tone: string }> = {
  waiting: { text: "Not checked yet", tone: "bg-status-due text-ink" },
  found: { text: "Found", tone: "bg-status-paid/15 text-status-paid" },
  not_found: { text: "Not found: parents told", tone: "bg-status-overdue text-white" },
  cancelled: { text: "Register corrected", tone: "bg-ink/10 text-ink/60" },
};

/**
 * A boarder marked absent from class is on campus somewhere: the boarding master or matron looks
 * (dormitory, sick bay) and answers Found or Not found. Not found sends the parents an urgent SMS.
 */
async function Boarders({
  searchParams,
}: Pick<PageProps<"/dashboard/attendance/boarders">, "searchParams">) {
  const { actor } = await loadAttendanceActor();
  const done = (await searchParams).done;
  const list = await boarderAlerts(deps, actor);
  const canAnswer = canHandleBoarderAlerts(actor.permissions);
  const waiting = list.filter((a) => a.status === "waiting");
  return (
    <div className="flex flex-col gap-5">
      <p className="text-ink/70">
        Check the dormitory and sick bay. Parents are told only if a boarder is not found.
      </p>
      {done === "found" ? <Notice tone="success">Marked as found.</Notice> : null}
      {done === "not_found" ? (
        <Notice tone="error">Marked as not found: the parents have been sent an urgent SMS.</Notice>
      ) : null}
      {waiting.length === 0 && !done ? (
        <Notice tone="success">No absent boarders to check.</Notice>
      ) : null}
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3 [&>li]:min-w-0">
        {list.map((a) => {
          const s = a.student;
          const st = STATUS[a.status] ?? STATUS.waiting;
          return (
            <li
              key={a.id}
              className="flex flex-col gap-3 rounded-2xl border border-ink/10 bg-white p-4"
              data-testid="boarder-alert"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">
                    {s.firstName} {s.lastName}
                  </p>
                  <p className="text-sm text-ink/60">
                    {s.admissionNumber} · {s.class.name}
                    {s.stream ? ` ${s.stream.name}` : ""}
                    {s.house ? ` · ${s.house.name}` : ""}
                  </p>
                  <p className="text-sm text-ink/60">
                    Absent from {a.session.toLowerCase() || "the"} register at{" "}
                    {nairobiTime(a.createdAt)}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${st.tone}`}>
                  {st.text}
                </span>
              </div>
              {a.note ? <p className="text-sm text-ink/80">{a.note}</p> : null}
              {a.status === "waiting" && canAnswer ? (
                <div className="grid grid-cols-2 gap-2">
                  <ActionForm
                    action={boarderAlertAction}
                    submitLabel="Found"
                    className="flex flex-col gap-2"
                  >
                    <input type="hidden" name="alertId" value={a.id} />
                    <input type="hidden" name="found" value="1" />
                  </ActionForm>
                  <ActionForm
                    action={boarderAlertAction}
                    submitLabel="Not found"
                    variant="danger"
                    className="flex flex-col gap-2"
                  >
                    <input type="hidden" name="alertId" value={a.id} />
                    <input type="hidden" name="found" value="0" />
                  </ActionForm>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
