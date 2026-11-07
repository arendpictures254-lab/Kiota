/**
 * The app's frame for staff and Arend admins (CLAUDE.md, "Responsive design"):
 *  - phones and tablets: a top bar (school, user menu) and a bottom tab bar with the role's
 *    main sections;
 *  - from 1024 px: a left sidebar with the school's crest and name, the user menu and the
 *    sections, and the content filling the rest.
 * Sections come from the person's permissions (never role names). Content width follows the
 * page type: "wide" for dashboards and lists, "form" for forms, "reading" for text.
 */
import Image from "next/image";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { chooseModeAction, signOutAction } from "@/app/session-actions";
import type { PermissionKey } from "@/lib/auth/catalog";
import { getCurrentUser, getSchoolContext, hasChildren, listMySchools } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { canHandleBoarderAlerts, canTakeAttendance } from "@/lib/attendance/service";
import { canSeeAcademics } from "@/lib/academics/setup";
import { canSeeLeaveouts } from "@/lib/leaveout/service";
import { canSeeMessages } from "@/lib/messaging/service";
import { canSeeKitchen, canSeeStores } from "@/lib/stores/service";
import { SidebarNav, TabBar, type NavItem } from "./app-nav";

export type PageWidth = "wide" | "form" | "reading";

export const WIDTH: Record<PageWidth, string> = {
  wide: "max-w-[1440px]",
  form: "max-w-[720px]",
  reading: "max-w-[760px]",
};

type Perms = ReadonlySet<PermissionKey>;

/** The sections a person sees, most used first (the first four or five become phone tabs). */
export function schoolNavItems(p: Perms): NavItem[] {
  const items: NavItem[] = [{ href: "/dashboard", label: "Home", icon: "home", exact: true }];
  const students = p.has("students.view") || p.has("students.view.own_streams");
  const fees =
    p.has("fees.view") || p.has("fees.collect") || p.has("fees.setup") || p.has("fees.reports");
  const feesFirst = p.has("fees.collect") && !p.has("students.edit");
  if (fees && feesFirst) items.push({ href: "/dashboard/fees", label: "Fees", icon: "fees" });
  if (students)
    items.push({
      href: "/dashboard/students",
      label: p.has("students.view") ? "Students" : "My students",
      icon: "students",
    });
  // The register is a class teacher's daily task: high in the list.
  if (canTakeAttendance(p) || canHandleBoarderAlerts(p))
    items.push({ href: "/dashboard/attendance", label: "Attendance", icon: "attendance" });
  if (fees && !feesFirst) items.push({ href: "/dashboard/fees", label: "Fees", icon: "fees" });
  // After fees: a Director keeps Fees among the phone tabs; teachers have no Fees.
  if (canSeeAcademics(p))
    items.push({ href: "/dashboard/academics", label: "Academics", icon: "academics" });
  if (canSeeLeaveouts(p))
    items.push({ href: "/dashboard/leaveouts", label: "Leave-outs", icon: "leaveouts" });
  if (canSeeMessages(p))
    items.push({ href: "/dashboard/messages", label: "Messages", icon: "messages" });
  if (canSeeStores(p)) items.push({ href: "/dashboard/stores", label: "Stores", icon: "stores" });
  else if (canSeeKitchen(p))
    items.push({ href: "/dashboard/stores/kitchen", label: "Kitchen", icon: "kitchen" });
  if (p.has("gate.scan")) items.push({ href: "/gate", label: "Gate", icon: "gate" });
  if (p.has("staff.view")) items.push({ href: "/dashboard/staff", label: "Staff", icon: "staff" });
  if (p.has("structure.manage"))
    items.push({ href: "/dashboard/setup", label: "School setup", icon: "setup" });
  return items;
}

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Schools", icon: "schools", exact: true },
  { href: "/admin/demo-requests", label: "Demo requests", icon: "inbox" },
  { href: "/admin/messaging", label: "Messaging", icon: "messages" },
];

export function AppShell({
  title,
  back,
  actions,
  width = "wide",
  nav = "school",
  children,
}: {
  title?: ReactNode;
  back?: { href: string; label: string };
  /** Buttons beside the title (wrap under it on phones). */
  actions?: ReactNode;
  width?: PageWidth;
  nav?: "school" | "admin";
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)]">
      <aside className="hidden border-r border-ink/10 bg-white lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:overflow-y-auto print:hidden">
        <Suspense fallback={<SidebarSkeleton />}>
          <Sidebar nav={nav} />
        </Suspense>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-ink/10 bg-cream/95 backdrop-blur lg:hidden print:hidden">
          <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
            <Link
              href={nav === "admin" ? "/admin" : "/dashboard"}
              className="flex min-w-0 items-center gap-2"
            >
              <Image src="/brand/kiota-icon.svg" alt="" width={28} height={28} />
              <Suspense
                fallback={<span className="font-heading text-lg font-bold text-teal">Kiota</span>}
              >
                <TopTitle nav={nav} />
              </Suspense>
            </Link>
            <Suspense fallback={null}>
              <UserMenu compact />
            </Suspense>
          </div>
        </header>
        <main
          className={`mx-auto flex w-full ${WIDTH[width]} flex-1 flex-col gap-5 px-4 pt-5 pb-28 sm:px-6 lg:px-10 lg:pt-8 lg:pb-12`}
        >
          {back ? (
            <Link
              href={back.href}
              className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-teal print:hidden"
            >
              ← {back.label}
            </Link>
          ) : null}
          {title || actions ? (
            <div className="flex flex-wrap items-end justify-between gap-3">
              {title ? (
                <h1 className="font-heading text-title font-bold text-ink">{title}</h1>
              ) : (
                <span />
              )}
              {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
            </div>
          ) : null}
          {children}
        </main>
      </div>
      <Suspense fallback={null}>
        <Tabs nav={nav} />
      </Suspense>
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-5" aria-hidden>
      <div className="h-10 w-32 rounded-lg bg-ink/5" />
      <div className="h-24 rounded-xl bg-ink/5" />
    </div>
  );
}

async function navFor(nav: "school" | "admin") {
  if (nav === "admin") return ADMIN_NAV;
  const ctx = await getSchoolContext();
  return ctx ? schoolNavItems(ctx.permissions) : [];
}

async function Tabs({ nav }: { nav: "school" | "admin" }) {
  return <TabBar items={await navFor(nav)} label="Sections" />;
}

async function TopTitle({ nav }: { nav: "school" | "admin" }) {
  if (nav === "admin")
    return <span className="font-heading text-lg font-bold text-teal">Kiota admin</span>;
  const ctx = await getSchoolContext();
  return (
    <span className="truncate font-heading text-lg font-bold text-teal">
      {ctx?.school.name ?? "Kiota"}
    </span>
  );
}

async function Sidebar({ nav }: { nav: "school" | "admin" }) {
  const ctx = nav === "school" ? await getSchoolContext() : null;
  const logo = ctx
    ? (
        await db(ctx.dbContext).school.findUnique({
          where: { id: ctx.school.id },
          select: { logoUrl: true },
        })
      )?.logoUrl
    : null;
  return (
    <>
      <div className="flex flex-col gap-4 border-b border-ink/10 p-5">
        <Link href={nav === "admin" ? "/admin" : "/dashboard"} className="flex items-center gap-3">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- private school crest
            <img src="/files/crest" alt="" className="size-11 rounded-lg object-contain" />
          ) : (
            <Image src="/brand/kiota-icon.svg" alt="" width={40} height={40} />
          )}
          <span className="flex min-w-0 flex-col">
            <span className="font-heading text-base leading-tight font-bold text-ink">
              {nav === "admin" ? "Arend Studio" : (ctx?.school.name ?? "Kiota")}
            </span>
            <span className="text-xs text-ink/60">
              {nav === "admin" ? "Kiota admin" : "on Kiota"}
            </span>
          </span>
        </Link>
        <UserMenu />
      </div>
      <div className="flex-1 py-4">
        <SidebarNav items={await navFor(nav)} label="Sections" />
      </div>
      <p className="flex items-center gap-1 px-5 pb-5 text-xs text-ink/50">
        Powered by
        <Image
          src="/brand/kiota-logo-horizontal.svg"
          alt="kiota"
          width={56}
          height={16}
          style={{ width: "auto", height: "1rem" }}
        />
      </p>
    </>
  );
}

/** Who is signed in, with Account, switching (school, parent view) and Sign out. */
async function UserMenu({ compact = false }: { compact?: boolean }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const ctx = await getSchoolContext();
  const [schools, parent] = await Promise.all([listMySchools(user.id), hasChildren(user.id)]);
  const name = ctx?.displayName ?? user.name;
  const item =
    "flex min-h-11 w-full items-center rounded-xl px-3 text-left font-semibold text-ink hover:bg-egg-blue/30";
  return (
    <details className={`group relative ${compact ? "" : "w-full"}`}>
      <summary
        data-testid="user-menu"
        className={`flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl ${
          compact ? "px-2" : "border border-ink/10 px-3 py-2"
        } hover:bg-egg-blue/20 [&::-webkit-details-marker]:hidden`}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-egg-blue font-heading text-sm font-bold text-teal">
          {name.slice(0, 1)}
        </span>
        <span className={`min-w-0 flex-col ${compact ? "sr-only sm:not-sr-only sm:flex" : "flex"}`}>
          <span className="truncate text-sm font-semibold text-ink">{name}</span>
          {ctx ? (
            <span className="truncate text-xs text-ink/60">
              {ctx.roles.map((r) => r.name).join(", ")}
            </span>
          ) : null}
        </span>
      </summary>
      <div
        className={`absolute z-40 mt-2 flex w-60 flex-col gap-1 rounded-2xl border border-ink/10 bg-white p-2 shadow-lg ${
          compact ? "right-0" : "left-0"
        }`}
      >
        <Link href="/account" className={item}>
          Account
        </Link>
        {schools.length > 1 ? (
          <Link href="/schools" className={item}>
            Switch school
          </Link>
        ) : null}
        {parent ? (
          <form action={chooseModeAction}>
            <input type="hidden" name="mode" value="parent" />
            <button type="submit" className={item}>
              Parent view
            </button>
          </form>
        ) : null}
        {user.isPlatformAdmin ? (
          <Link href="/admin" className={item}>
            Arend admin
          </Link>
        ) : null}
        <form action={signOutAction}>
          <button type="submit" className={item}>
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
