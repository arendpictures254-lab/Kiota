import type { Metadata } from "next";
import { Suspense } from "react";
import { signOutEverywhereAction } from "@/app/session-actions";
import { SignOutButton } from "@/components/sign-out-button";
import { Button, Card, Loading, Shell } from "@/components/ui";
import { hasChildren, requireUser } from "@/lib/auth/context";
import { listSessions } from "@/lib/auth/session";
import { type MessageKey, day } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { formatPhone } from "@/lib/phone";
import { LanguageForm } from "./language-form";

export const metadata: Metadata = { title: "Account · Kiota" };

export default function AccountPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <Loading />
        </Shell>
      }
    >
      <Account />
    </Suspense>
  );
}

function device(ua: string | null): MessageKey {
  if (!ua) return "account.device.other";
  if (/Android/i.test(ua)) return "account.device.android";
  if (/iPhone|iPad/i.test(ua)) return "account.device.iphone";
  if (/Windows/i.test(ua)) return "account.device.windows";
  if (/Macintosh/i.test(ua)) return "account.device.mac";
  return "account.device.other";
}

async function Account() {
  const user = await requireUser();
  const [{ t, locale }, sessions, parent] = await Promise.all([
    getT(),
    listSessions(user.id),
    hasChildren(user.id),
  ]);
  return (
    <Shell
      title={t("account.title")}
      back={
        parent ? { href: "/parent", label: t("nav.allChildren") } : { href: "/", label: "Kiota" }
      }
      aside={<SignOutButton />}
    >
      <Card>
        <p className="text-sm text-ink/70">{t("account.phone")}</p>
        <p className="font-semibold">{formatPhone(user.phone)}</p>
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-section font-bold">{t("account.language")}</h2>
        <LanguageForm
          current={locale}
          text={{
            hint: t("account.languageHint"),
            save: t("account.save"),
            en: t("lang.en"),
            sw: t("lang.sw"),
            label: t("account.language"),
          }}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-section font-bold">{t("account.sessions")}</h2>
        <ul className="flex flex-col gap-2">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded-2xl border border-ink/10 bg-white p-4"
            >
              <span className="flex flex-col">
                <span className="font-semibold">{t(device(s.userAgent))}</span>
                <span className="text-sm text-ink/60">
                  {t("account.since", { date: day(s.createdAt, locale) })}
                </span>
              </span>
              {s.id === user.session.id ? (
                <span className="text-sm font-semibold text-status-paid">
                  {t("account.thisDevice")}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        <form action={signOutEverywhereAction} className="flex flex-col gap-2">
          <Button type="submit" variant="danger">
            {t("account.signOutEverywhere")}
          </Button>
          <p className="text-sm text-ink/60">{t("account.signOutEverywhereHint")}</p>
        </form>
      </section>
    </Shell>
  );
}
