import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { chooseModeAction, signOutAction } from "@/app/session-actions";
import type { T } from "@/lib/i18n";
import { type ChildLink, childLabel } from "@/lib/portal/service";

/**
 * The parent portal's frame: a light top bar, the child switcher (like switching accounts:
 * photo, first name, class and school), then one column. No images beyond the logo and small
 * photos, so it stays quick on a cheap phone over mobile data.
 */
export function ParentShell({
  t,
  kids,
  current,
  isStaff,
  title,
  back,
  children,
}: {
  t: T;
  kids: ChildLink[];
  /** The child being viewed; null on the "All children" page. */
  current: string | null;
  isStaff: boolean;
  title?: string;
  back?: { href: string; label: string };
  children: ReactNode;
}) {
  const live = kids.filter((k) => !k.pending);
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-ink/10 bg-cream">
        <div className="mx-auto flex h-14 w-full max-w-md items-center justify-between gap-2 px-4">
          <Link href="/parent" className="flex items-center gap-2">
            <Image src="/brand/kiota-icon.svg" alt="" width={28} height={28} />
            <span className="font-heading text-lg font-bold text-teal">Kiota</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm font-semibold text-teal">
            {isStaff ? (
              <form action={chooseModeAction}>
                <input type="hidden" name="mode" value="staff" />
                <button type="submit" className="h-11 rounded-lg px-2 hover:bg-egg-blue/30">
                  {t("nav.switchToStaff")}
                </button>
              </form>
            ) : null}
            <Link
              href="/account"
              className="flex h-11 items-center rounded-lg px-2 hover:bg-egg-blue/30"
            >
              {t("nav.account")}
            </Link>
            <form action={signOutAction}>
              <button type="submit" className="h-11 rounded-lg px-2 hover:bg-egg-blue/30">
                {t("nav.signOut")}
              </button>
            </form>
          </nav>
        </div>
        {live.length > 0 ? (
          <nav
            aria-label={t("child.switch")}
            className="mx-auto w-full max-w-md overflow-x-auto px-2 pb-3"
          >
            <ul className="flex gap-2 px-2">
              {live.length > 1 ? (
                <li>
                  <SwitchItem href="/parent" active={current === null} label={t("nav.allChildren")}>
                    <span className="flex size-11 items-center justify-center rounded-full bg-teal text-lg font-bold text-white">
                      {live.length}
                    </span>
                  </SwitchItem>
                </li>
              ) : null}
              {live.map((k) => (
                <li key={k.linkId}>
                  <SwitchItem
                    href={`/parent/${k.linkId}`}
                    active={current === k.linkId}
                    label={k.firstName}
                    sub={[childLabel(k), k.schoolName].filter(Boolean).join(" · ")}
                  >
                    <Avatar child={k} />
                  </SwitchItem>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-5">
        {back ? (
          <Link href={back.href} className="text-sm font-semibold text-teal">
            ← {back.label}
          </Link>
        ) : null}
        {title ? <h1 className="font-heading text-2xl font-bold text-ink">{title}</h1> : null}
        {children}
      </main>
    </div>
  );
}

function SwitchItem({
  href,
  active,
  label,
  sub,
  children,
}: {
  href: string;
  active: boolean;
  label: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex w-24 shrink-0 flex-col items-center gap-1 rounded-2xl p-2 text-center ${
        active ? "bg-white ring-2 ring-teal" : "hover:bg-white"
      }`}
    >
      {children}
      <span className="w-full truncate text-sm font-semibold text-ink">{label}</span>
      {sub ? (
        <span className="line-clamp-2 w-full text-xs leading-tight text-ink/60">{sub}</span>
      ) : null}
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
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex items-center justify-center rounded-full bg-egg-blue font-heading font-bold text-teal"
      style={{ width: size, height: size, fontSize: size / 2.6 }}
    >
      {child.firstName.slice(0, 1)}
      {child.lastName?.slice(0, 1) ?? ""}
    </span>
  );
}
