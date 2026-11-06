import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading, Notice } from "@/components/ui";
import { deps } from "@/lib/actions";
import { isoDay, nairobiDate, parseDay } from "@/lib/attendance/rules";
import { loadRegister } from "@/lib/attendance/service";
import { AttendanceShell, dayLabel, hhmm, loadAttendanceActor, nairobiTime } from "../shared";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Register · Kiota" };

type Props = PageProps<"/dashboard/attendance/register">;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default function RegisterPage({ searchParams }: Props) {
  return (
    <AttendanceShell>
      <Suspense fallback={<Loading />}>
        <Register searchParams={searchParams} />
      </Suspense>
    </AttendanceShell>
  );
}

async function Register({ searchParams }: Pick<Props, "searchParams">) {
  const { actor } = await loadAttendanceActor();
  const sp = await searchParams;
  const date = parseDay(one(sp.date)) ?? nairobiDate(new Date());
  let reg;
  try {
    reg = await loadRegister(deps, actor, {
      streamId: one(sp.stream),
      sessionId: one(sp.session),
      date,
    });
  } catch {
    return <Notice tone="error">This register isn&apos;t one you can take.</Notice>;
  }
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-title font-bold text-ink">
          {reg.stream.label} · {reg.session.name}
        </h1>
        <p className="text-ink/70">
          {dayLabel(reg.date)} · {reg.rows.length} students · cut-off{" "}
          {hhmm(reg.session.cutoffMinute)}
        </p>
      </header>
      {reg.submitted ? (
        <Notice tone="success">
          Submitted by {reg.submitted.by} at {nairobiTime(reg.submitted.at)}
          {reg.submitted.correctedAt
            ? `, corrected at ${nairobiTime(reg.submitted.correctedAt)}`
            : ""}
          .{" "}
          {reg.editable.ok
            ? "You can still correct it today."
            : "Only the Principal can change it now."}
        </Notice>
      ) : null}
      {!reg.editable.ok && !reg.submitted ? <Notice>{reg.editable.reason}</Notice> : null}
      {reg.rows.length === 0 ? (
        <p className="text-ink/60">No students in this stream yet.</p>
      ) : (
        <RegisterForm
          streamId={reg.stream.id}
          sessionId={reg.session.id}
          date={isoDay(reg.date)}
          rows={reg.rows}
          editable={reg.editable.ok}
          submitted={!!reg.submitted}
        />
      )}
    </div>
  );
}
