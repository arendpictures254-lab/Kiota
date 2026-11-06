import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading, Notice } from "@/components/ui";
import { formatPhone } from "@/lib/phone";
import { requireParent } from "@/lib/portal/context";
import { declineLinkAction } from "../../actions";
import { ParentShell } from "../../parent-shell";
import { ConfirmForm } from "./confirm-form";

export const metadata: Metadata = { title: "Add a child · Kiota" };

export default function ConfirmPage({ params }: PageProps<"/parent/confirm/[linkId]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Confirm params={params} />
    </Suspense>
  );
}

async function Confirm({ params }: Pick<PageProps<"/parent/confirm/[linkId]">, "params">) {
  const { linkId } = await params;
  const { user, children, isStaff, t } = await requireParent();
  const pending = children.find((c) => c.linkId === linkId && c.pending);

  if (!pending) {
    return (
      <ParentShell
        width="form"
        t={t}
        kids={children}
        current={null}
        isStaff={isStaff}
        back={{ href: "/parent", label: t("nav.allChildren") }}
      >
        <Notice>{t("pending.gone")}</Notice>
      </ParentShell>
    );
  }
  const vars = { school: pending.schoolName, child: pending.firstName };
  return (
    <ParentShell
      width="form"
      t={t}
      kids={children}
      current={null}
      isStaff={isStaff}
      title={t("pending.title", vars)}
      back={{ href: "/parent", label: t("nav.allChildren") }}
    >
      <p className="text-ink/80">{t("pending.explain", vars)}</p>
      <ConfirmForm
        linkId={linkId}
        text={{
          send: t("pending.sendCode"),
          sent: t("pending.codeSent", { phone: formatPhone(user.phone) }),
          code: t("pending.code"),
          confirm: t("pending.confirm", vars),
          checking: t("signin.checking"),
          sending: t("signin.sending"),
          resend: t("signin.resend"),
        }}
      />
      <form action={declineLinkAction} className="flex flex-col gap-2 border-t border-ink/10 pt-4">
        <input type="hidden" name="linkId" value={linkId} />
        <button
          type="submit"
          className="h-12 rounded-xl border border-status-overdue/40 bg-white px-5 font-semibold text-status-overdue"
        >
          {t("pending.decline")}
        </button>
        <p className="text-sm text-ink/60">{t("pending.declineHint", vars)}</p>
      </form>
    </ParentShell>
  );
}
