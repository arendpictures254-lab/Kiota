import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Loading, Notice } from "@/components/ui";
import { deps } from "@/lib/actions";
import { allLeaveoutReasons, getSchoolSettings } from "@/lib/settings/service";
import { leaveoutReasonAction, leaveoutSettingsAction } from "../actions";
import { LeaveoutsShell, loadLeaveoutActor } from "../shared";

export const metadata: Metadata = { title: "Leave-out settings · Kiota" };

export default function LeaveoutSettingsPage() {
  return (
    <LeaveoutsShell title="Leave-out settings" width="form">
      <Suspense fallback={<Loading />}>
        <Settings />
      </Suspense>
    </LeaveoutsShell>
  );
}

/** The Director's rules for leave-outs: the reasons parents and staff choose from, and how early
 * before the leave time the gate lets a child go. */
async function Settings() {
  const { actor } = await loadLeaveoutActor();
  if (!actor.permissions.has("school.settings.manage"))
    return <Notice tone="error">Only the Director can change leave-out settings.</Notice>;
  const [settings, reasons] = await Promise.all([
    getSchoolSettings(deps, actor),
    allLeaveoutReasons(deps, actor),
  ]);
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-section font-bold">At the gate</h2>
        <ActionForm action={leaveoutSettingsAction} submitLabel="Save">
          <Field
            label="Earliest exit before the leave time (minutes)"
            name="earlyExitMinutes"
            inputMode="numeric"
            defaultValue={String(settings.leaveoutEarlyExitMinutes)}
            hint="The gate refuses a pass earlier than this. 60 = one hour before."
            required
          />
        </ActionForm>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-section font-bold">Reasons</h2>
        <p className="text-sm text-ink/70">
          What staff and parents choose from. Hidden reasons stay on old leave-outs.
        </p>
        <ol className="flex flex-col gap-2">
          {reasons.map((r, i) => (
            <li key={r.id}>
              <Card className={`flex flex-col gap-3 p-3 ${r.active ? "" : "opacity-60"}`}>
                <ActionForm
                  action={leaveoutReasonAction}
                  submitLabel="Rename"
                  variant="secondary"
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2"
                >
                  <input type="hidden" name="intent" value="rename" />
                  <input type="hidden" name="id" value={r.id} />
                  <Field
                    label={`Reason ${i + 1}${r.active ? "" : " (hidden)"}`}
                    name="name"
                    id={`reason-${r.id}`}
                    defaultValue={r.name}
                    required
                  />
                </ActionForm>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["up", "Move up", i === 0],
                      ["down", "Move down", i === reasons.length - 1],
                      ["toggle", r.active ? "Hide" : "Show again", false],
                    ] as const
                  ).map(([intent, label, disabled]) =>
                    disabled ? null : (
                      <ActionForm
                        key={intent}
                        action={leaveoutReasonAction}
                        submitLabel={label}
                        variant="secondary"
                        className="w-36"
                      >
                        <input type="hidden" name="intent" value={intent} />
                        <input type="hidden" name="id" value={r.id} />
                      </ActionForm>
                    ),
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ol>
        <ActionForm action={leaveoutReasonAction} submitLabel="Add reason" variant="secondary">
          <input type="hidden" name="intent" value="add" />
          <Field
            label="New reason"
            name="name"
            id="reason-new"
            placeholder="Church service"
            required
          />
        </ActionForm>
      </section>
    </div>
  );
}
