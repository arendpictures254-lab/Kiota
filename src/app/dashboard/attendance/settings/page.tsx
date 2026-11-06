import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Loading, Notice } from "@/components/ui";
import { deps } from "@/lib/actions";
import { canManageAttendance } from "@/lib/attendance/service";
import { attendanceSessions, clock, getSchoolSettings } from "@/lib/settings/service";
import { absenceSettingsAction, sessionAction } from "../actions";
import { AttendanceShell, loadAttendanceActor } from "../shared";

export const metadata: Metadata = { title: "Register times and alerts · Kiota" };

export default function AttendanceSettingsPage() {
  return (
    <AttendanceShell title="Register times and alerts" width="form">
      <Suspense fallback={<Loading />}>
        <Settings />
      </Suspense>
    </AttendanceShell>
  );
}

function Check({
  name,
  label,
  hint,
  on,
}: {
  name: string;
  label: string;
  hint: string;
  on: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink/10 p-3">
      <input type="checkbox" name={name} defaultChecked={on} className="mt-1 size-5 accent-teal" />
      <span>
        <span className="block font-semibold">{label}</span>
        <span className="block text-sm text-ink/60">{hint}</span>
      </span>
    </label>
  );
}

async function Settings() {
  const { actor } = await loadAttendanceActor();
  if (!canManageAttendance(actor.permissions))
    return <Notice tone="error">For the Principal and Director.</Notice>;
  const [s, sessions] = await Promise.all([
    getSchoolSettings(deps, actor),
    attendanceSessions(deps, actor, true),
  ]);
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-section font-bold">Who is told about an absence</h2>
        <ActionForm action={absenceSettingsAction} submitLabel="Save">
          <Check
            name="daySms"
            on={s.absenceSmsDayScholars}
            label="SMS the parents of an absent day scholar"
            hint="In the parent's language, from the messaging wallet, within quiet hours."
          />
          <Field
            label="Wait before sending (minutes)"
            name="delayMinutes"
            inputMode="numeric"
            defaultValue={String(s.absenceSmsDelayMinutes)}
            hint="So a quick correction (a student in the toilet) never alarms a parent."
            required
          />
          <Check
            name="boarderSms"
            on={s.absenceSmsBoarders}
            label="Also SMS a boarder's parents straight away"
            hint="Off: the boarding master and matron check first, and parents are told only if the boarder is not found (urgent)."
          />
        </ActionForm>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-section font-bold">Register times</h2>
        <p className="text-sm text-ink/70">
          Registers not submitted by the cut-off show on the Principal&apos;s and Director&apos;s
          dashboards (Monday to Friday).
        </p>
        {sessions.map((se) => (
          <Card key={se.id} className="p-3">
            <ActionForm
              action={sessionAction}
              submitLabel="Save"
              variant="secondary"
              className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-end"
            >
              <input type="hidden" name="id" value={se.id} />
              <Field label="Name" name="name" id={`n-${se.id}`} defaultValue={se.name} required />
              <Field
                label="Opens"
                name="opens"
                id={`o-${se.id}`}
                defaultValue={clock(se.opensMinute)}
                required
              />
              <Field
                label="Cut-off"
                name="cutoff"
                id={`c-${se.id}`}
                defaultValue={clock(se.cutoffMinute)}
                required
              />
              <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-3">
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={se.active}
                  className="size-5 accent-teal"
                />
                Taken every school day
              </label>
            </ActionForm>
          </Card>
        ))}
        <Card className="p-3">
          <ActionForm
            action={sessionAction}
            submitLabel="Add register"
            variant="secondary"
            className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-end"
          >
            <Field
              label="New register"
              name="name"
              id="n-new"
              placeholder="Evening prep"
              required
            />
            <Field label="Opens" name="opens" id="o-new" placeholder="19:00" required />
            <Field label="Cut-off" name="cutoff" id="c-new" placeholder="19:30" required />
          </ActionForm>
        </Card>
      </section>
    </div>
  );
}
