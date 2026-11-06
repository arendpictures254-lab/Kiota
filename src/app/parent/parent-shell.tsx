import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { SidebarNav, TabBar, type NavItem } from "@/components/app-nav";
import { WIDTH, type PageWidth } from "@/components/app-shell";
import { chooseModeAction, signOutAction } from "@/app/session-actions";
import type { T } from "@/lib/i18n";
import { type ChildLink, childLabel, sections } from "@/lib/portal/service";

/**
 * The parent portal's frame (CLAUDE.md, "Responsive design"):
 *  - phones: a top bar, the children (one child: a slim header; several: chips with the full
 *    school name), and a bottom tab bar for the child's sections;
 *  - from 1024 px: a sidebar with the children and the child's sections, content beside it.
 * Light on purpose: no images beyond the logo and small photos, for cheap phones on mobile data.
 */
export function ParentShell({
  t,
  kids,
  current,
  isStaff,
  title,
  back,
  width = "wide",
  children,
}: {
  t: T;
  kids: ChildLink[];
  /** The child being viewed; null on the "All children" page. */
  current: string | null;
  isStaff: boolean;
  title?: string;
  back?: { href: string; label: string };
  width?: PageWidth;
  children: ReactNode;
}) {
  const live = kids.filter((k) => !k.pending);
  // The child whose sections the tabs show: the one being viewed, or the only one.
  const focus = live.find((k) => k.linkId === current) ?? (live.length === 1 ? live[0] : null);
  const items: NavItem[] = [
    {
      href: focus && live.length === 1 ? `/parent/${focus.linkId}` : "/parent",
      label: live.length > 1 ? t("nav.allChildren") : (focus?.firstName ?? t("home.title")),
      icon: "home",
      exact: true,
    },
  ];
  if (focus) {
    if (live.length > 1)
      items.push({
        href: `/parent/${focus.linkId}`,
        label: focus.firstName,
        icon: "students",
        exact: true,
      });
    const s = sections(focus);
    if (s.fees)
      items.push({ href: `/parent/${focus.linkId}/fees`, label: t("child.fees"), icon: "fees" });
    if (s.notices)
      items.push({
        href: `/parent/${focus.linkId}/notices`,
        label: t("child.notices"),
        icon: "notices",
      });
    if (s.leaveOuts)
      items.push({
        href: `/parent/${focus.linkId}/leaveouts`,
        label: t("child.leaveOuts"),
        icon: "leaveouts",
      });
  }
  items.push({ href: "/account", label: t("nav.account"), icon: "account" });

  const staffSwitch = (className: string) =>
    isStaff ? (
      <form action={chooseModeAction}>
        <input type="hidden" name="mode" value="staff" />
        <button type="submit" className={className}>
          {t("nav.switchToStaff")}
        </button>
      </form>
    ) : null;
  const signOut = (
    <form action={signOutAction}>
      <button
        type="submit"
        className="flex min-h-11 w-full items-center rounded-xl px-3 text-left font-semibold text-ink/70 hover:bg-egg-blue/30"
      >
        {t("nav.signOut")}
      </button>
    </form>
  );
  const menu = (
    <div className="flex flex-col gap-1">
      {staffSwitch(
        "flex min-h-11 w-full items-center rounded-xl px-3 text-left font-semibold text-teal hover:bg-egg-blue/30",
      )}
      {signOut}
    </div>
  );

  return (
    <div className="flex flex-1 flex-col lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      {/* Sidebar (from 1024 px) */}
      <aside className="hidden border-r border-ink/10 bg-white lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:overflow-y-auto">
        <Link href="/parent" className="flex items-center gap-2 border-b border-ink/10 p-5">
          <Image src="/brand/kiota-icon.svg" alt="" width={32} height={32} />
          <span className="font-heading text-xl font-bold text-teal">Kiota</span>
        </Link>
        {live.length ? (
          <nav
            aria-label={t("child.switch")}
            className="flex flex-col gap-1 border-b border-ink/10 p-3"
          >
            {live.length > 1 ? (
              <Link
                href="/parent"
                aria-current={current === null ? "page" : undefined}
                className={`flex min-h-11 items-center rounded-xl px-3 font-semibold ${current === null ? "bg-egg-blue/40 text-ink" : "text-ink/70 hover:bg-egg-blue/20"}`}
              >
                {t("nav.allChildren")}
              </Link>
            ) : null}
            {live.map((k) => (
              <Link
                key={k.linkId}
                href={`/parent/${k.linkId}`}
                aria-current={current === k.linkId ? "page" : undefined}
                className={`flex items-center gap-3 rounded-xl p-2 ${current === k.linkId ? "bg-egg-blue/40" : "hover:bg-egg-blue/20"}`}
              >
                <Avatar child={k} size={40} />
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold text-ink">{k.firstName}</span>
                  <span className="text-xs leading-snug text-ink/60">{childLabel(k)}</span>
                  <span className="text-xs leading-snug text-ink/60">{k.schoolName}</span>
                </span>
              </Link>
            ))}
          </nav>
        ) : null}
        <div className="flex-1 py-3">
          <SidebarNav
            items={items.filter((i) => i.icon !== "home" && i.icon !== "students")}
            label={t("nav.children")}
          />
        </div>
        <div className="border-t border-ink/10 p-3">{menu}</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar and children (phones and tablets) */}
        <header className="border-b border-ink/10 bg-cream lg:hidden">
          <div className="flex h-14 items-center justify-between gap-2 px-4 sm:px-6">
            <Link href="/parent" className="flex items-center gap-2">
              <Image src="/brand/kiota-icon.svg" alt="" width={28} height={28} />
              <span className="font-heading text-lg font-bold text-teal">Kiota</span>
            </Link>
            <div className="flex items-center gap-1">
              {staffSwitch(
                "flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold text-teal hover:bg-egg-blue/30",
              )}
              <details className="relative">
                <summary
                  data-testid="user-menu"
                  className="flex min-h-11 cursor-pointer list-none items-center rounded-lg px-2 text-sm font-semibold text-teal [&::-webkit-details-marker]:hidden"
                >
                  {t("nav.account")} ▾
                </summary>
                <div className="absolute right-0 z-40 mt-1 w-56 rounded-2xl border border-ink/10 bg-white p-2 shadow-lg">
                  <Link
                    href="/account"
                    className="flex min-h-11 items-center rounded-xl px-3 font-semibold text-ink hover:bg-egg-blue/30"
                  >
                    {t("nav.account")}
                  </Link>
                  {signOut}
                </div>
              </details>
            </div>
          </div>
          {live.length === 1 ? (
            <Link
              href={`/parent/${live[0].linkId}`}
              className="flex items-center gap-3 px-4 pb-3 sm:px-6"
            >
              <Avatar child={live[0]} size={40} />
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold text-ink">
                  {live[0].firstName} {live[0].lastName}
                </span>
                <span className="text-sm leading-snug text-ink/60">
                  {[childLabel(live[0]), live[0].schoolName].filter(Boolean).join(" · ")}
                </span>
              </span>
            </Link>
          ) : live.length > 1 ? (
            <nav aria-label={t("child.switch")} className="px-4 pb-3 sm:px-6">
              <ul className="flex flex-wrap gap-2">
                <li>
                  <Chip href="/parent" active={current === null}>
                    <span className="font-semibold">{t("nav.allChildren")}</span>
                  </Chip>
                </li>
                {live.map((k) => (
                  <li key={k.linkId}>
                    <Chip href={`/parent/${k.linkId}`} active={current === k.linkId}>
                      <Avatar child={k} size={28} />
                      <span className="flex flex-col leading-tight">
                        <span className="font-semibold">{k.firstName}</span>
                        <span className="text-xs text-ink/60">{k.schoolName}</span>
                      </span>
                    </Chip>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </header>

        <main
          className={`mx-auto flex w-full ${WIDTH[width]} flex-1 flex-col gap-5 px-4 pt-5 pb-28 sm:px-6 lg:px-10 lg:pt-8 lg:pb-12`}
        >
          {back ? (
            <Link
              href={back.href}
              className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-teal"
            >
              ← {back.label}
            </Link>
          ) : null}
          {title ? <h1 className="font-heading text-title font-bold text-ink">{title}</h1> : null}
          {children}
        </main>
      </div>
      <TabBar items={items} label={t("nav.children")} />
    </div>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-11 items-center gap-2 rounded-full border px-3 py-1 text-sm ${
        active
          ? "border-teal bg-white ring-2 ring-teal"
          : "border-ink/15 bg-white hover:border-teal/40"
      }`}
    >
      {children}
    </Link>
  );
}

export function Avatar({ child, size = 44 }: { child: ChildLink; size?: number }) {
  if (child.hasPhoto) {
    return (
      // A plain <img>: the photo is private (checked per request), so no image optimiser.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/parent/photo/${child.linkId}`}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-egg-blue font-heading font-bold text-teal"
      style={{ width: size, height: size, fontSize: size / 2.6 }}
    >
      {child.firstName.slice(0, 1)}
      {child.lastName?.slice(0, 1) ?? ""}
    </span>
  );
}
