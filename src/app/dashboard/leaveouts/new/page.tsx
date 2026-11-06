import type { Metadata } from "next";
import { Suspense } from "react";
import { Button, Field, Loading, Notice } from "@/components/ui";
import { deps } from "@/lib/actions";
import { withContext } from "@/lib/db-core";
import { toNairobiInput } from "@/lib/leaveout/rules";
import { authorisedCollectors, canRequestLeaveouts, leaveoutReasons } from "@/lib/leaveout/service";
import { ctxOf } from "@/lib/service-kit";
import { LeaveoutsShell, loadLeaveoutActor } from "../shared";
import { RequestForm } from "./request-form";

export const metadata: Metadata = { title: "Request a leave-out · Kiota" };

export default function NewLeaveoutPage({ searchParams }: PageProps<"/dashboard/leaveouts/new">) {
  return (
    <LeaveoutsShell title="Request a leave-out">
      <Suspense fallback={<Loading />}>
        <NewLeaveout searchParams={searchParams} />
      </Suspense>
    </LeaveoutsShell>
  );
}

async function NewLeaveout({
  searchParams,
}: Pick<PageProps<"/dashboard/leaveouts/new">, "searchParams">) {
  const { actor } = await loadLeaveoutActor();
  if (!canRequestLeaveouts(actor.permissions)) {
    return <Notice tone="error">You cannot request leave-outs.</Notice>;
  }
  const admission = String((await searchParams).student ?? "").trim();
  const student = admission
    ? await withContext(deps.db, ctxOf(actor), (tx) =>
        tx.student.findFirst({
          where: {
            schoolId: actor.schoolId,
            status: "active",
            admissionNumber: { equals: admission, mode: "insensitive" },
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            admissionNumber: true,
            boarder: true,
            class: { select: { name: true } },
            stream: { select: { name: true } },
          },
        }),
      )
    : null;

  const find = (
    <form action="/dashboard/leaveouts/new" className="flex flex-col gap-3">
      <Field
        label="Admission number"
        name="student"
        defaultValue={admission}
        required
        autoFocus={!student}
        placeholder="BA/2025/001"
      />
      <Button type="submit" variant={student ? "secondary" : "primary"}>
        Find student
      </Button>
    </form>
  );
  if (!student) {
    return (
      <div className="flex flex-col gap-4">
        {admission ? (
          <Notice tone="error">No student you can see has admission number “{admission}”.</Notice>
        ) : null}
        {find}
      </div>
    );
  }
  const [collectors, reasons] = await Promise.all([
    authorisedCollectors(deps, actor, student.id),
    leaveoutReasons(deps, actor),
  ]);
  const start = new Date(new Date().getTime() + 3600_000);
  start.setUTCMinutes(0, 0, 0);
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border border-ink/10 bg-white p-4">
        <p className="font-heading text-lg font-bold">
          {student.firstName} {student.lastName}
        </p>
        <p className="text-sm text-ink/60">
          {student.admissionNumber} · {student.class.name}
          {student.stream ? ` ${student.stream.name}` : ""} ·{" "}
          {student.boarder ? "Boarder" : "Day scholar"}
        </p>
      </div>
      <RequestForm
        studentId={student.id}
        reasons={reasons}
        collectors={collectors.map((c) => ({ id: c.id, label: `${c.name} (${c.relationship})` }))}
        defaultLeave={toNairobiInput(start)}
        defaultReturn={toNairobiInput(new Date(start.getTime() + 2 * 86_400_000))}
      />
      {find}
    </div>
  );
}
