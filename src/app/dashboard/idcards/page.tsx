import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { AppShell } from "@/components/app-shell";
import { Button, Field, Loading, Notice, Select } from "@/components/ui";
import { actorFor, deps } from "@/lib/actions";
import { requireSchool } from "@/lib/auth/context";
import { canPrintCards, previewCards } from "@/lib/idcards/service";
import { passQrSvg } from "@/lib/leaveout/qr";
import { enabledClasses, getStructure } from "@/lib/structure/service";
import { cardContactsAction } from "./actions";

export const metadata: Metadata = { title: "ID cards · Kiota" };

type Props = PageProps<"/dashboard/idcards">;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default function IdCardsPage({ searchParams }: Props) {
  return (
    <AppShell title="Student ID cards" back={{ href: "/dashboard/students", label: "Students" }}>
      <Suspense fallback={<Loading />}>
        <Cards searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}

async function Cards({ searchParams }: Pick<Props, "searchParams">) {
  const ctx = await requireSchool();
  const actor = await actorFor(ctx);
  if (!canPrintCards(actor.permissions))
    return <Notice tone="error">Printing ID cards is for the office (idcards.print).</Notice>;
  const sp = await searchParams;
  const pick = one(sp.group);
  const student = one(sp.student);
  const structure = await getStructure(deps, actor);
  const options = enabledClasses(structure).flatMap((c) => [
    { value: `class:${c.id}`, label: `All of ${c.name}` },
    ...c.streams.map((s) => ({ value: `stream:${s.id}`, label: `${c.name} ${s.name}` })),
  ]);
  const group = pick || options.find((o) => o.value.startsWith("stream:"))?.value || "";
  const [kind, id] = group.split(":");
  const audience = student
    ? { studentIds: [student] }
    : kind === "stream"
      ? { streamId: id }
      : kind === "class"
        ? { classId: id }
        : null;
  const preview = audience ? await previewCards(deps, actor, audience).catch(() => null) : null;
  const query = student ? `student=${student}` : `${kind}=${id}`;
  const qr = new Map(
    await Promise.all(
      (preview?.cards ?? [])
        .filter((c) => c.token)
        .map(async (c) => [c.studentId, await passQrSvg(c.token!)] as const),
    ),
  );

  return (
    <div className="flex flex-col gap-6">
      <form className="flex flex-col gap-3 sm:flex-row sm:items-end sm:[&>*:first-child]:w-80">
        <Select
          label="Print for"
          name="group"
          defaultValue={student ? "" : group}
          options={options}
        />
        <Button type="submit" variant="secondary">
          Show cards
        </Button>
      </form>

      {preview ? (
        <>
          <div className="flex flex-col gap-3 rounded-2xl border border-ink/10 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-ink/80">
              <strong>{preview.cards.length}</strong> card{preview.cards.length === 1 ? "" : "s"}
              {preview.cards.some((c) => !c.token)
                ? ` · ${preview.cards.filter((c) => !c.token).length} new (issued when you print)`
                : ""}
              {preview.cards.some((c) => !c.hasPhoto)
                ? ` · ${preview.cards.filter((c) => !c.hasPhoto).length} without a photo`
                : ""}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <a
                href={`/dashboard/idcards/pdf?${query}&format=a4`}
                className="inline-flex h-12 items-center justify-center rounded-xl bg-teal px-5 font-semibold text-white"
              >
                A4 sheets (PDF)
              </a>
              <a
                href={`/dashboard/idcards/pdf?${query}&format=cr80`}
                className="inline-flex h-12 items-center justify-center rounded-xl border border-teal/30 bg-white px-5 font-semibold text-teal"
              >
                For a card printer (PDF)
              </a>
            </div>
          </div>
          <p className="text-sm text-ink/60">
            A4: 8 cards a page with crop marks; print the backs on the reverse (long edge), cut and
            laminate. Card printer: CR80 size, front and back.
          </p>
          <ul
            className="grid grid-cols-1 gap-6 md:grid-cols-2 2xl:grid-cols-3"
            data-testid="card-preview"
          >
            {preview.cards.map((c) => (
              <li key={c.studentId} className="flex flex-col gap-2">
                <CardFront c={c} school={preview.school} qr={qr.get(c.studentId) ?? null} />
                <CardBack school={preview.school} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <Notice>Choose a class or stream.</Notice>
      )}

      <section className="flex max-w-[720px] flex-col gap-3">
        <h2 className="font-heading text-section font-bold">The back of the card</h2>
        <ActionForm action={cardContactsAction} submitLabel="Save" variant="secondary">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="School phone"
              name="phone"
              defaultValue={preview?.school.phone ?? ""}
              inputMode="tel"
            />
            <Field
              label="Email"
              name="email"
              defaultValue={preview?.school.email ?? ""}
              type="email"
            />
          </div>
          <Field
            label="Address"
            name="address"
            defaultValue={preview?.school.address ?? ""}
            placeholder="P.O. Box 123, Kilifi"
          />
        </ActionForm>
      </section>
    </div>
  );
}

type Preview = NonNullable<Awaited<ReturnType<typeof previewCards>>>;

/** The card on screen at its real shape (85.6 × 54 mm), scaled to the column. */
function CardFront({
  c,
  school,
  qr,
}: {
  c: Preview["cards"][number];
  school: Preview["school"];
  qr: string | null;
}) {
  return (
    <div
      className="@container relative aspect-[85.6/54] w-full max-w-[420px] overflow-hidden rounded-[4%/6%] border border-ink/15 bg-white shadow-sm"
      aria-label={`ID card front: ${c.name}`}
    >
      <div className="flex h-[20%] items-center gap-[3%] bg-teal px-[3.5%] text-white">
        {school.hasCrest ? (
          // eslint-disable-next-line @next/next/no-img-element -- the school's crest
          <img src="/files/crest" alt="" className="h-[75%] w-auto object-contain" />
        ) : null}
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate font-heading text-[4.6cqw] font-bold">{school.name}</span>
          <span className="text-[2.6cqw] tracking-wide text-white/80">STUDENT IDENTITY CARD</span>
        </span>
      </div>
      <div className="flex h-[80%] gap-[3.5%] p-[3.5%]">
        <div className="aspect-[4/5] h-[88%] shrink-0 overflow-hidden rounded bg-cream">
          {c.hasPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element -- private, permission-checked photo
            <img
              src={`/files/students/${c.studentId}/photo`}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            <span className="flex size-full items-center justify-center text-[2.6cqw] text-ink/50">
              No photo
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-[1.5cqw]">
          <p className="line-clamp-2 text-[4.4cqw] leading-tight font-bold text-ink">{c.name}</p>
          <Line label="Admission no." value={c.admissionNumber} />
          <Line label="Class" value={c.classLabel} />
          <Line
            label={c.boarder ? "Boarder" : "Day scholar"}
            value={`Valid until ${c.validUntilYear}`}
          />
        </div>
        <div className="absolute right-[3%] bottom-[4%] size-[21%]">
          {qr ? (
            <span
              className="block size-full [&>svg]:size-full"
              dangerouslySetInnerHTML={{ __html: qr }}
            />
          ) : (
            <span className="flex size-full items-center justify-center rounded border border-dashed border-ink/30 text-center text-[2.2cqw] text-ink/50">
              QR when printed
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex min-w-0 flex-col pr-[24%] leading-tight">
      <span className="text-[2.6cqw] text-ink/60">{label}</span>
      <span className="truncate text-[3.3cqw] font-semibold text-ink">{value}</span>
    </p>
  );
}

function CardBack({ school }: { school: Preview["school"] }) {
  return (
    <div
      className="@container relative aspect-[85.6/54] w-full max-w-[420px] overflow-hidden rounded-[4%/6%] border border-ink/15 bg-cream shadow-sm"
      aria-label="ID card back"
    >
      <div className="h-[5.5%] bg-teal" />
      <div className="flex flex-col gap-[1.2cqw] p-[6%]">
        <p className="text-[3.5cqw] font-bold text-ink">If found, please return to:</p>
        <p className="truncate font-heading text-[4.2cqw] font-bold text-teal">{school.name}</p>
        {[school.address, school.phone ? `Phone: ${school.phone}` : null, school.email]
          .filter(Boolean)
          .map((l) => (
            <p key={l} className="truncate text-[3.2cqw] text-ink">
              {l}
            </p>
          ))}
        {!school.address && !school.phone && !school.email ? (
          <p className="text-[3cqw] text-status-due">Add the school&apos;s contacts below.</p>
        ) : null}
      </div>
      <p className="absolute right-[4%] bottom-[5%] flex items-center gap-[1cqw] text-[2.4cqw] text-ink/60">
        Powered by
        {/* eslint-disable-next-line @next/next/no-img-element -- small brand mark */}
        <img src="/brand/kiota-logo-horizontal.svg" alt="kiota" className="h-[3.2cqw] w-auto" />
      </p>
    </div>
  );
}
