import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Field, Loading, Notice } from "@/components/ui";
import { deps } from "@/lib/actions";
import { canApproveLeaveouts, leaveoutReasons } from "@/lib/leaveout/service";
import { enabledClasses, getStructure } from "@/lib/structure/service";
import { halfTermAction } from "../actions";
import { LeaveoutsShell, loadLeaveoutActor } from "../shared";

export const metadata: Metadata = { title: "Half term · Kiota" };

const control =
  "h-12 rounded-xl border border-ink/20 bg-white px-4 text-base text-ink outline-none focus:border-teal focus:ring-2 focus:ring-teal/30";

export default function HalfTermPage() {
  return (
    <LeaveoutsShell title="Half term passes">
      <Suspense fallback={<Loading />}>
        <HalfTerm />
      </Suspense>
    </LeaveoutsShell>
  );
}

async function HalfTerm() {
  const { actor } = await loadLeaveoutActor();
  if (!canApproveLeaveouts(actor.permissions))
    return (
      <Notice tone="error">
        Only staff the Director allows to approve leave-outs can do this.
      </Notice>
    );
  const [structure, reasons] = await Promise.all([
    getStructure(deps, actor),
    leaveoutReasons(deps, actor),
  ]);
  const levels = structure.levels.filter((l) => l.enabled);
  const classes = enabledClasses(structure);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink/80">
        One approved pass for every student in the group, collected by their first guardian marked
        “authorised to collect”. Each collector gets a pickup code by SMS. Students with no such
        guardian are listed and skipped.
      </p>
      <ActionForm action={halfTermAction} submitLabel="Issue the passes" pendingLabel="Issuing…">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="audience" className="text-sm font-semibold">
            Who
          </label>
          <select
            id="audience"
            name="audience"
            required
            defaultValue="boarders"
            className={control}
          >
            <option value="boarders">All boarders</option>
            <optgroup label="A level">
              {levels.map((l) => (
                <option key={l.id} value={`level:${l.id}`}>
                  {l.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="A class">
              {classes.map((c) => (
                <option key={c.id} value={`class:${c.id}`}>
                  {c.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="A stream">
              {classes.flatMap((c) =>
                c.streams.map((s) => (
                  <option key={s.id} value={`stream:${s.id}`}>
                    {c.name} {s.name}
                  </option>
                )),
              )}
            </optgroup>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reasonId" className="text-sm font-semibold">
            Reason
          </label>
          <select
            id="reasonId"
            name="reasonId"
            defaultValue={reasons.find((r) => r.name === "Half term")?.id ?? ""}
            className={control}
          >
            {reasons.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <Field label="Leave" name="leaveAt" type="datetime-local" required />
        <Field label="Back by" name="returnAt" type="datetime-local" required />
      </ActionForm>
    </div>
  );
}
