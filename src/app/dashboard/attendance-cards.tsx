import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { isoDay } from "@/lib/attendance/rules";
import type { myRegisters } from "@/lib/attendance/service";
import type { myStaffDay } from "@/lib/attendance/staff";
import { staffTapAction } from "./attendance/actions";
import { nairobiTime } from "./attendance/shared";

/** "I'm in" / "I'm leaving" for every staff member (no location is recorded). */
export function StaffDayCard({ day }: { day: Awaited<ReturnType<typeof myStaffDay>> }) {
  const inAt = day?.inAt ?? null;
  const outAt = day?.outAt ?? null;
  return (
    <section
      aria-label="My attendance"
      className="flex flex-col gap-3 rounded-2xl border border-ink/10 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
      data-testid="staff-day"
    >
      <p className="text-ink">
        {inAt ? (
          <>
            <span className="font-semibold">In at {nairobiTime(inAt)}</span>
            {outAt ? <span className="text-ink/70"> · left at {nairobiTime(outAt)}</span> : null}
          </>
        ) : day?.status === "leave" ? (
          <span className="font-semibold">On leave today</span>
        ) : (
          <span className="font-semibold">Good morning. Tap when you arrive.</span>
        )}
      </p>
      {day?.status === "leave" ? null : (
        <ActionForm
          action={staffTapAction}
          submitLabel={inAt ? "I'm leaving" : "I'm in"}
          variant={inAt ? "secondary" : "primary"}
          className="flex flex-col gap-2 sm:w-48"
        >
          <input type="hidden" name="kind" value={inAt ? "out" : "in"} />
        </ActionForm>
      )}
    </section>
  );
}

/** A class teacher's registers still to take today: their first job in the morning. */
export function RegistersToTake({ r }: { r: Awaited<ReturnType<typeof myRegisters>> }) {
  const todo = r.streams.flatMap((st) =>
    st.registers
      .filter((x) => !x.submittedAt)
      .map((x) => ({ st, x, s: r.sessions.find((se) => se.id === x.sessionId)! }))
      .filter(({ s }) => s.open),
  );
  if (!todo.length) return null;
  return (
    <section aria-label="Registers to take" className="flex flex-col gap-2">
      {todo.slice(0, 3).map(({ st, x, s }) => (
        <Link
          key={`${st.id}-${s.id}`}
          href={`/dashboard/attendance/register?stream=${st.id}&session=${s.id}&date=${isoDay(r.today)}`}
          className={`flex min-h-14 items-center justify-between gap-3 rounded-2xl px-5 font-semibold ${
            x.overdue ? "bg-status-overdue text-white" : "bg-teal text-white"
          }`}
        >
          <span>
            Take the {s.name.toLowerCase()} register · {st.label}
          </span>
          <span aria-hidden>{x.overdue ? "Late →" : "→"}</span>
        </Link>
      ))}
    </section>
  );
}

export function BoardersToCheck({ count }: { count: number }) {
  if (!count) return null;
  return (
    <Link
      href="/dashboard/attendance/boarders"
      className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-status-overdue px-5 font-semibold text-white"
      data-testid="boarders-to-check"
    >
      <span>
        {count} absent boarder{count === 1 ? "" : "s"} to check
      </span>
      <span aria-hidden>→</span>
    </Link>
  );
}
