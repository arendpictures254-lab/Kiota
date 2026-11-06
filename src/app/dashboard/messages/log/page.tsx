import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Loading } from "@/components/ui";
import { deps } from "@/lib/actions";
import { kes } from "@/lib/fees/allocation";
import { listMessages } from "@/lib/messaging/service";
import { formatPhone } from "@/lib/phone";
import { nairobi } from "../../fees/shared";
import { MessagesShell, STATUS_LABEL, STATUS_TONE, loadMessagesActor } from "../shared";

export const metadata: Metadata = { title: "Message history · Kiota" };

type Props = PageProps<"/dashboard/messages/log">;

export default function MessageLogPage({ searchParams }: Props) {
  return (
    <MessagesShell title="Message history">
      <Suspense fallback={<Loading />}>
        <Log searchParams={searchParams} />
      </Suspense>
    </MessagesShell>
  );
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

async function Log({ searchParams }: Pick<Props, "searchParams">) {
  const { actor } = await loadMessagesActor();
  const sp = await searchParams;
  const f = {
    status: one(sp.status),
    studentId: one(sp.student),
    guardianLinkId: one(sp.guardian),
    campaignId: one(sp.campaign),
  };
  const rows = await listMessages(deps, actor, f);
  const filtered = f.studentId || f.guardianLinkId || f.campaignId;
  const seesAll = actor.permissions.has("messages.view_all");
  const keep = (status: string) => {
    const q = new URLSearchParams();
    if (f.studentId) q.set("student", f.studentId);
    if (f.guardianLinkId) q.set("guardian", f.guardianLinkId);
    if (f.campaignId) q.set("campaign", f.campaignId);
    if (status) q.set("status", status);
    return `/dashboard/messages/log${q.size ? `?${q}` : ""}`;
  };
  return (
    <div className="flex flex-col gap-4">
      {!seesAll ? (
        <p className="text-sm text-ink/60">
          You see messages about the students you can see. The Director sees every message.
        </p>
      ) : null}
      {filtered ? (
        <p className="text-sm">
          {rows[0]?.student && f.studentId
            ? `Messages about ${rows[0].student.name}. `
            : rows[0]?.guardian && f.guardianLinkId
              ? `Messages to ${rows[0].guardian}. `
              : "Filtered. "}
          <Link href="/dashboard/messages/log" className="font-semibold text-teal">
            Show all
          </Link>
        </p>
      ) : null}
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2 text-sm">
        {["", "queued", "sent", "delivered", "failed"].map((s) => (
          <Link
            key={s || "all"}
            href={keep(s)}
            aria-current={f.status === s ? "page" : undefined}
            className="rounded-full border border-ink/15 bg-white px-3 py-1.5 font-semibold text-ink/70 aria-[current=page]:border-teal aria-[current=page]:bg-teal aria-[current=page]:text-white"
          >
            {s ? STATUS_LABEL[s] : "All"}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <Card>
          <p className="text-ink/70">No messages yet.</p>
        </Card>
      ) : (
        <ul className="grid items-start gap-2 xl:grid-cols-2">
          {rows.map((m) => (
            <li
              key={m.id}
              className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-ink/10 bg-white p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink">
                  {m.guardian ?? formatPhone(m.to)}
                  <span className="font-normal text-ink/60">
                    {" "}
                    · {m.channel === "sms" ? "SMS" : "WhatsApp"}
                    {m.fallback ? " (instead of WhatsApp)" : ""}
                  </span>
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[m.status]}`}
                >
                  {STATUS_LABEL[m.status]}
                </span>
              </div>
              <p className="text-sm [overflow-wrap:anywhere] text-ink/80">{m.body}</p>
              <p className="text-xs text-ink/60">
                {nairobi(m.createdAt)}
                {m.student ? (
                  <>
                    {" · "}
                    <Link
                      href={`/dashboard/messages/log?student=${m.student.id}`}
                      className="text-teal"
                    >
                      {m.student.name} ({m.student.admissionNumber})
                    </Link>
                  </>
                ) : null}
                {" · "}
                {m.channel === "sms" ? `${m.units} unit${m.units === 1 ? "" : "s"} · ` : ""}
                {kes(m.costCents)}
                {m.critical ? " · Emergency" : ""}
              </p>
              {m.status === "queued" && m.nextAttemptAt > new Date() ? (
                <p className="text-xs text-status-due">Goes out {nairobi(m.nextAttemptAt)}</p>
              ) : null}
              {m.error ? <p className="text-xs text-status-overdue">{m.error}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
