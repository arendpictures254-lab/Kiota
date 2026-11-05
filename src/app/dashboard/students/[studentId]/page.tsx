import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import {
  ButtonLink,
  Card,
  Checkbox,
  Field,
  Loading,
  Notice,
  Select,
  TextArea,
} from "@/components/ui";
import { deps } from "@/lib/actions";
import { withContext } from "@/lib/db-core";
import { kes as kesFromCents } from "@/lib/fees/allocation";
import { studentPosition } from "@/lib/fees/ledger";
import { ctxOf } from "@/lib/service-kit";
import { formatPhone } from "@/lib/phone";
import { getStructure } from "@/lib/structure/service";
import { LANGUAGES, RELATIONSHIPS, STATUSES, fullName } from "@/lib/students/rules";
import { getStudent } from "@/lib/students/service";
import {
  changeStatusAction,
  setSubjectsAction,
  uploadDocumentAction,
  uploadPhotoAction,
} from "../actions";
import { StudentsShell, isoDay, kes, loadStudentsActor, showDate } from "../shared";
import { canSeeMessages } from "@/lib/messaging/service";

export const metadata: Metadata = { title: "Student · Kiota" };

type Props = PageProps<"/dashboard/students/[studentId]">;

export default function StudentPage({ params, searchParams }: Props) {
  return (
    <StudentsShell>
      <Suspense fallback={<Loading />}>
        <Student params={params} searchParams={searchParams} />
      </Suspense>
    </StudentsShell>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-ink/5 py-2 last:border-0">
      <dt className="text-ink/60">{label}</dt>
      <dd className="text-right font-medium text-ink">{children || "—"}</dd>
    </div>
  );
}

async function Student({ params, searchParams }: Props) {
  const { studentId } = await params;
  const sp = await searchParams;
  const { actor } = await loadStudentsActor();
  if (!/^[0-9a-f-]{36}$/i.test(studentId)) notFound();
  const s = await getStudent(deps, actor, studentId);
  if (!s) notFound();

  const canEdit = actor.permissions.has("students.edit");
  const canFees = actor.permissions.has("fees.view") || actor.permissions.has("fees.collect");
  const feeBalance = canFees
    ? await withContext(deps.db, ctxOf(actor), (tx) => studentPosition(tx, actor.schoolId, s.id))
    : null;
  const feePhone = s.guardians.find((g) => g.receivesFees)?.user.phone;
  const canMedical = actor.permissions.has("students.medical.view");
  const senior = s.class.level.key === "senior";
  const structure = senior && canEdit ? await getStructure(deps, actor) : null;
  const level = structure?.levels.find((l) => l.id === s.class.levelId);
  const relationship = (v: string) => RELATIONSHIPS.find((r) => r.value === v)?.label ?? v;
  const language = (v: string) => LANGUAGES.find((l) => l.value === v)?.label ?? v;

  return (
    <div className="flex flex-col gap-5">
      {sp.added ? <Notice tone="success">Student added.</Notice> : null}
      {sp.saved ? <Notice tone="success">Changes saved.</Notice> : null}

      <div className="flex items-center gap-4">
        {s.photoKey ? (
          // eslint-disable-next-line @next/next/no-img-element -- private, permission-checked file
          <img
            src={`/files/students/${s.id}/photo?v=${encodeURIComponent(s.photoKey)}`}
            alt={`Photo of ${s.firstName}`}
            className="size-20 rounded-2xl object-cover"
          />
        ) : (
          <div className="flex size-20 items-center justify-center rounded-2xl bg-egg-blue/40 font-heading text-2xl font-bold text-teal">
            {s.firstName[0]}
            {s.lastName[0]}
          </div>
        )}
        <div>
          <h1 className="font-heading text-2xl font-bold text-ink">{fullName(s)}</h1>
          <p className="text-ink/70">
            {s.admissionNumber} · {s.class.name}
            {s.stream ? ` ${s.stream.name}` : ""}
          </p>
          {s.status !== "active" ? (
            <p className="text-sm font-semibold text-status-overdue capitalize">{s.status}</p>
          ) : null}
        </div>
      </div>

      {canEdit ? (
        <ButtonLink href={`/dashboard/students/${s.id}/edit`}>Edit details</ButtonLink>
      ) : null}

      <Card>
        <dl className="text-sm">
          <Row label="Gender">{s.gender === "female" ? "Female" : "Male"}</Row>
          <Row label="Date of birth">{showDate(s.dateOfBirth)}</Row>
          <Row label="Level">{s.class.level.name}</Row>
          <Row label="Boarding">{s.boarder ? "Boarder" : "Day scholar"}</Row>
          <Row label="House">{s.house?.name}</Row>
          <Row label="UPI (NEMIS)">{s.upi}</Row>
          <Row label="Special needs">{s.specialNeeds}</Row>
          {s.pathway ? <Row label="Pathway">{s.pathway.name}</Row> : null}
          {s.subjects.length ? (
            <Row label="Subjects">{s.subjects.map((x) => x.subject.name).join(", ")}</Row>
          ) : null}
          {s.openingBalance ? (
            <Row label="Opening balance">
              {kes(s.openingBalance.amountCents)}
              {s.openingBalance.posted ? "" : " (not yet in fees)"}
            </Row>
          ) : null}
        </dl>
      </Card>

      {canMedical ? (
        <Card className="border-status-overdue/30">
          <h2 className="font-heading text-lg font-bold text-status-overdue">
            Medical (restricted)
          </h2>
          <dl className="text-sm">
            <Row label="Medical notes">{s.medical?.medicalNotes}</Row>
            <Row label="Allergies">{s.medical?.allergies}</Row>
          </dl>
        </Card>
      ) : null}

      {feeBalance ? (
        <Card className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-heading text-lg font-bold">Fees</h2>
            <span
              className={`font-heading text-2xl font-bold ${feeBalance.balanceCents > 0 ? "text-status-overdue" : "text-status-paid"}`}
            >
              {feeBalance.balanceCents < 0
                ? `${kesFromCents(-feeBalance.balanceCents)} credit`
                : kesFromCents(feeBalance.balanceCents)}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {actor.permissions.has("fees.collect") ? (
              <ButtonLink href={`/dashboard/fees/pay?student=${s.id}`} variant="secondary">
                Record a payment
              </ButtonLink>
            ) : null}
            {actor.permissions.has("fees.collect") && feePhone ? (
              <ButtonLink
                href={`/dashboard/fees/mpesa?adm=${encodeURIComponent(s.admissionNumber)}&phone=${encodeURIComponent(feePhone)}`}
                variant="secondary"
              >
                Send M-Pesa prompt
              </ButtonLink>
            ) : null}
            <a
              href={`/files/statements/${s.id}`}
              className="text-center text-sm font-semibold text-teal hover:underline"
            >
              Fee statement (PDF)
            </a>
          </div>
        </Card>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold">Guardians</h2>
        {s.guardians.length === 0 ? (
          <Notice>No guardian yet. Add one so the school can reach the family.</Notice>
        ) : null}
        {s.guardians.map((g) => (
          <Card key={g.id} className="flex flex-col gap-1">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{g.name}</p>
                <p className="text-sm text-ink/70">
                  {relationship(g.relationship)} · {formatPhone(g.user.phone)} ·{" "}
                  {language(g.language)}
                </p>
              </div>
              {canEdit ? (
                <Link
                  href={`/dashboard/students/${s.id}/guardians/${g.id}`}
                  className="text-sm font-semibold text-teal"
                >
                  Edit
                </Link>
              ) : null}
            </div>
            <p className="text-sm text-ink/60">
              {[
                g.receivesFees && "Fees",
                g.receivesAcademics && "Results",
                g.receivesBoarding && "Boarding alerts",
                g.authorisedToCollect && "May collect at leave-out",
                g.whatsapp && "WhatsApp",
              ]
                .filter(Boolean)
                .join(" · ") || "Receives no messages"}
            </p>
          </Card>
        ))}
        {canEdit ? (
          <ButtonLink href={`/dashboard/students/${s.id}/guardians/new`} variant="secondary">
            Add a guardian
          </ButtonLink>
        ) : null}
        {canSeeMessages(actor.permissions) ? (
          <Link
            href={`/dashboard/messages/log?student=${s.id}`}
            className="text-sm font-semibold text-teal"
          >
            Messages sent to these guardians
          </Link>
        ) : null}
      </section>

      {senior && canEdit && level ? (
        <Card>
          <ActionForm action={setSubjectsAction} submitLabel="Save subjects" variant="secondary">
            <h2 className="font-heading text-lg font-bold">Pathway and subjects</h2>
            <input type="hidden" name="studentId" value={s.id} />
            <Select
              label="Pathway"
              name="pathwayId"
              defaultValue={s.pathwayId ?? ""}
              placeholder="No pathway"
              options={level.pathways.map((p) => ({ value: p.id, label: p.name }))}
            />
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-sm font-semibold">Subjects</legend>
              {level.subjects.map((sub) => (
                <Checkbox
                  key={sub.id}
                  name="subjects"
                  value={sub.id}
                  label={sub.name}
                  defaultChecked={s.subjects.some((x) => x.subjectId === sub.id)}
                />
              ))}
            </fieldset>
          </ActionForm>
        </Card>
      ) : null}

      {canEdit ? (
        <Card>
          <ActionForm action={uploadPhotoAction} submitLabel="Save photo" variant="secondary">
            <h2 className="font-heading text-lg font-bold">Photo</h2>
            <input type="hidden" name="studentId" value={s.id} />
            <Field
              label="Photo (JPG or PNG, up to 5 MB)"
              name="file"
              id="photo-file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              required
            />
          </ActionForm>
        </Card>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold">Documents</h2>
        {s.documents.length === 0 ? <p className="text-sm text-ink/60">No documents.</p> : null}
        <ul className="flex flex-col gap-2">
          {s.documents.map((d) => (
            <li key={d.id}>
              <a
                href={`/files/students/${s.id}/documents/${d.id}`}
                className="flex flex-col rounded-2xl border border-ink/10 bg-white p-3 hover:border-teal"
              >
                <span className="font-semibold">{d.kind}</span>
                <span className="text-sm text-ink/60">
                  {d.fileName} · {showDate(d.createdAt)}
                </span>
              </a>
            </li>
          ))}
        </ul>
        {canEdit ? (
          <ActionForm
            action={uploadDocumentAction}
            submitLabel="Upload document"
            variant="secondary"
          >
            <input type="hidden" name="studentId" value={s.id} />
            <Select
              label="Document"
              name="kind"
              options={[
                "Birth certificate",
                "Previous school report",
                "Transfer letter",
                "Other",
              ].map((k) => ({ value: k, label: k }))}
            />
            <Field
              label="File (PDF or photo, up to 5 MB)"
              name="file"
              id="doc-file"
              type="file"
              accept="application/pdf,image/*"
              required
            />
          </ActionForm>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold">Status history</h2>
        <ul className="flex flex-col gap-2">
          {s.statusChanges.map((c) => (
            <li key={c.id} className="rounded-2xl border border-ink/10 bg-white p-3 text-sm">
              <span className="font-semibold capitalize">{c.toStatus}</span>
              <span className="text-ink/60">
                {" "}
                · {showDate(c.date)}
                {c.reason ? ` · ${c.reason}` : ""}
              </span>
            </li>
          ))}
        </ul>
        {canEdit ? (
          <Card>
            <ActionForm action={changeStatusAction} submitLabel="Change status" variant="secondary">
              <input type="hidden" name="studentId" value={s.id} />
              <Select label="New status" name="status" defaultValue={s.status} options={STATUSES} />
              <Field
                label="Date"
                name="date"
                type="date"
                defaultValue={isoDay(new Date())}
                required
              />
              <TextArea label="Reason" name="reason" hint="Needed for everything except Active." />
            </ActionForm>
          </Card>
        ) : null}
      </section>
    </div>
  );
}
