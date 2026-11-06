import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SendConfirmForm } from "@/components/send-confirm-form";
import { Checkbox, Loading } from "@/components/ui";
import { deps } from "@/lib/actions";
import { canSendNotices, portalSignIns } from "@/lib/messaging/service";
import { formatPhone } from "@/lib/phone";
import { enabledClasses, getStructure } from "@/lib/structure/service";
import { inviteAction } from "../actions";
import { MessagesShell, loadMessagesActor } from "../shared";

export const metadata: Metadata = { title: "Invite parents · Kiota" };

export default function InvitePage({ searchParams }: PageProps<"/dashboard/messages/invite">) {
  return (
    <MessagesShell width="form" title="Invite parents to Kiota">
      <Suspense fallback={<Loading />}>
        <Invite searchParams={searchParams} />
      </Suspense>
    </MessagesShell>
  );
}

const control =
  "h-12 rounded-xl border border-ink/20 bg-white px-4 text-base text-ink outline-none focus:border-teal focus:ring-2 focus:ring-teal/30";

async function Invite({
  searchParams,
}: Pick<PageProps<"/dashboard/messages/invite">, "searchParams">) {
  const { ctx, actor } = await loadMessagesActor();
  if (!canSendNotices(actor.permissions)) redirect("/dashboard/messages");
  const show = String((await searchParams).show ?? "school");
  const structure = await getStructure(deps, actor);
  const classes = enabledClasses(structure);
  const groups = [
    { label: "Everyone", options: [{ value: "school", label: "All parents and guardians" }] },
    { label: "A class", options: classes.map((c) => ({ value: `class:${c.id}`, label: c.name })) },
    {
      label: "A stream",
      options: classes.flatMap((c) =>
        c.streams.map((s) => ({ value: `stream:${s.id}`, label: `${c.name} ${s.name}` })),
      ),
    },
  ].filter((g) => g.options.length);
  const status = await portalSignIns(deps, actor, show).catch(() => portalSignIns(deps, actor));
  const notYet = status.rows.filter((r) => !r.signedInAt);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-ink/80">
        Each parent gets one SMS in their language: “{ctx.school.name} now uses Kiota. Sign in at
        app.kiota.app with this phone number to see fees and receipts.” Paid from the messaging
        wallet.
      </p>
      <SendConfirmForm action={inviteAction} checkLabel="Check who and the cost">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="audience" className="text-sm font-semibold text-ink">
            Invite
          </label>
          <select id="audience" name="audience" required defaultValue="school" className={control}>
            {groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <Checkbox
          name="onlyNew"
          label="Only parents who have not signed in yet"
          description="Leave this on to follow up without sending a second SMS to parents already using Kiota."
          defaultChecked
        />
      </SendConfirmForm>

      <section className="flex flex-col gap-3" aria-labelledby="signed-in">
        <h2 id="signed-in" className="font-heading text-section font-bold">
          Who has signed in
        </h2>
        <form className="flex gap-2" action="/dashboard/messages/invite">
          <select name="show" defaultValue={show} aria-label="Show" className={`${control} flex-1`}>
            {groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            type="submit"
            className="h-12 rounded-xl border border-teal/30 bg-white px-4 font-semibold text-teal"
          >
            Show
          </button>
        </form>
        <p className="text-ink/80" data-testid="signed-in-count">
          {status.signedIn} of {status.total} parents in {status.audienceLabel.toLowerCase()} have
          signed in at least once.
        </p>
        {notYet.length ? (
          <>
            <h3 className="font-semibold">Not signed in yet ({notYet.length})</h3>
            <ul className="flex flex-col gap-2">
              {notYet.slice(0, 100).map((r) => (
                <li
                  key={r.linkId}
                  className="flex flex-col rounded-2xl border border-ink/10 bg-white p-3"
                >
                  <span className="font-semibold">{r.name}</span>
                  <a href={`tel:${r.phone}`} className="text-sm text-teal">
                    {formatPhone(r.phone)}
                  </a>
                  <span className="text-sm text-ink/60">{r.children.join(", ")}</span>
                </li>
              ))}
            </ul>
            {notYet.length > 100 ? (
              <p className="text-sm text-ink/60">
                Showing the first 100. Choose a class or stream to see the rest.
              </p>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}
