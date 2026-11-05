import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Loading } from "@/components/ui";
import { deps } from "@/lib/actions";
import { canSendNotices, MAX_NOTICE_CHARS, TOPICS } from "@/lib/messaging/service";
import { walletOverview } from "@/lib/messaging/wallet";
import { enabledClasses, getStructure } from "@/lib/structure/service";
import { whatsappEnabled } from "@/lib/whatsapp";
import { MessagesShell, loadMessagesActor } from "../shared";
import { NoticeComposer } from "./notice-composer";

export const metadata: Metadata = { title: "Send a notice · Kiota" };

export default function NewNoticePage() {
  return (
    <MessagesShell title="Send a notice">
      <Suspense fallback={<Loading />}>
        <Composer />
      </Suspense>
    </MessagesShell>
  );
}

async function Composer() {
  const { ctx, actor } = await loadMessagesActor();
  if (!canSendNotices(actor.permissions)) redirect("/dashboard/messages");
  const [structure, wallet] = await Promise.all([
    getStructure(deps, actor),
    walletOverview(deps, actor),
  ]);
  const levels = structure.levels.filter((l) => l.enabled);
  const classes = enabledClasses(structure);
  const groups = [
    {
      label: "Everyone",
      options: [
        { value: "school", label: "Whole school" },
        { value: "boarders", label: "Boarders only" },
        { value: "day", label: "Day scholars only" },
      ],
    },
    { label: "A level", options: levels.map((l) => ({ value: `level:${l.id}`, label: l.name })) },
    { label: "A class", options: classes.map((c) => ({ value: `class:${c.id}`, label: c.name })) },
    {
      label: "A stream",
      options: classes.flatMap((c) =>
        c.streams.map((s) => ({ value: `stream:${s.id}`, label: `${c.name} ${s.name}` })),
      ),
    },
  ].filter((g) => g.options.length);
  return (
    <NoticeComposer
      groups={groups}
      topics={TOPICS}
      prefix={`${ctx.school.name}: `}
      smsUnitPriceCents={wallet.prices.smsUnitPriceCents}
      maxChars={MAX_NOTICE_CHARS}
      whatsapp={whatsappEnabled()}
    />
  );
}
