import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Loading, Notice, Select, TextArea } from "@/components/ui";
import { academicsSetup, commentBank } from "@/lib/academics/setup";
import { deps } from "@/lib/actions";
import { addBankCommentAction, removeBankCommentAction } from "../../actions";
import { AcademicsShell, loadAcademicsActor, one } from "../../shared";

export const metadata: Metadata = { title: "Comment bank · Kiota" };

type Props = PageProps<"/dashboard/academics/setup/comments">;

export default function CommentBankPage({ searchParams }: Props) {
  return (
    <AcademicsShell title="Comment bank" width="form">
      <Suspense fallback={<Loading />}>
        <Bank searchParams={searchParams} />
      </Suspense>
    </AcademicsShell>
  );
}

async function Bank({ searchParams }: Pick<Props, "searchParams">) {
  const { actor } = await loadAcademicsActor();
  if (!actor.permissions.has("academics.setup"))
    return (
      <Notice tone="error">
        The comment bank is kept by the Director of Studies or the Principal.
      </Notice>
    );
  const setup = await academicsSetup(deps, actor);
  const levelId = one((await searchParams).level);
  const level = setup.levels.find((l) => l.id === levelId) ?? setup.levels[0];
  if (!level) return <Notice>Switch on the school&apos;s levels first.</Notice>;
  const bank = await commentBank(deps, actor, level.id);
  const scheme = setup.schemes.find((s) => s.id === level.schemeId);
  const bands = scheme?.levels.map((l) => ({ value: l.code, label: `${l.code} ${l.label}` })) ?? [];
  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Level" className="flex flex-wrap gap-2">
        {setup.levels.map((l) => (
          <Link
            key={l.id}
            href={`/dashboard/academics/setup/comments?level=${l.id}`}
            aria-current={l.id === level.id ? "page" : undefined}
            className="inline-flex min-h-11 items-center rounded-full border border-ink/15 bg-white px-4 text-sm font-semibold aria-[current=page]:border-teal aria-[current=page]:bg-teal aria-[current=page]:text-white"
          >
            {l.name}
          </Link>
        ))}
      </nav>
      <p className="text-sm text-ink/70">
        Teachers tap a suggestion and edit it. Suggestions matching the student&apos;s overall level
        come first. A code like EE also matches EE1 and EE2.
      </p>
      {(["class_teacher", "principal"] as const).map((author) => (
        <section key={author} aria-labelledby={`b-${author}`} className="flex flex-col gap-2">
          <h2 id={`b-${author}`} className="text-section font-bold">
            {author === "class_teacher" ? "Class teacher" : "Principal"}
          </h2>
          {bank.filter((b) => b.author === author).length === 0 ? (
            <p className="text-sm text-ink/60">No suggestions yet.</p>
          ) : null}
          <ul className="flex flex-col gap-2">
            {bank
              .filter((b) => b.author === author)
              .map((b) => (
                <li
                  key={b.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-ink/10 bg-white p-3"
                >
                  <span className="min-w-0 text-sm [overflow-wrap:anywhere]">
                    <b className="mr-1 text-teal">{b.bandCode}</b>
                    {b.text}
                  </span>
                  <ActionForm
                    action={removeBankCommentAction}
                    submitLabel="Remove"
                    variant="danger"
                    className="w-28 shrink-0"
                  >
                    <input type="hidden" name="id" value={b.id} />
                  </ActionForm>
                </li>
              ))}
          </ul>
        </section>
      ))}
      <ActionForm
        action={addBankCommentAction}
        submitLabel="Add suggestion"
        className="flex flex-col gap-3 rounded-2xl border border-ink/10 bg-white p-4"
      >
        <h2 className="text-section font-bold">Add a suggestion</h2>
        <input type="hidden" name="levelId" value={level.id} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="For"
            name="author"
            options={[
              { value: "class_teacher", label: "Class teacher" },
              { value: "principal", label: "Principal" },
            ]}
          />
          <Select label="Level it suits" name="bandCode" options={bands} />
        </div>
        <TextArea label="Comment" name="text" maxLength={600} />
      </ActionForm>
    </div>
  );
}
