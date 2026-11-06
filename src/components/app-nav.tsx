"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icons";

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  /** Active only on this exact path (for "Home"-like items). */
  exact?: boolean;
};

function isActive(path: string, item: NavItem) {
  if (item.exact) return path === item.href;
  return path === item.href || path.startsWith(`${item.href}/`);
}

/** The sections, down the left side from 1024 px. */
export function SidebarNav({ items, label }: { items: NavItem[]; label: string }) {
  const path = usePathname();
  return (
    <nav aria-label={label} className="flex flex-col gap-1 px-3">
      {items.map((item) => {
        const active = isActive(path, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-[0.95rem] font-semibold transition-colors ${
              active ? "bg-teal text-white" : "text-ink/80 hover:bg-egg-blue/30 hover:text-ink"
            }`}
          >
            <Icon name={item.icon} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The bottom tab bar on phones and tablets: up to five sections; with more, four and "More"
 * (a small menu with the rest).
 */
export function TabBar({ items, label }: { items: NavItem[]; label: string }) {
  const path = usePathname();
  if (items.length < 2) return null;
  const shown = items.length > 5 ? items.slice(0, 4) : items;
  const rest = items.length > 5 ? items.slice(4) : [];
  const restActive = rest.some((i) => isActive(path, i));
  const tab = (active: boolean) =>
    `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[0.7rem] font-semibold ${
      active ? "text-teal" : "text-ink/60"
    }`;
  return (
    <nav
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-ink/10 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden print:hidden"
    >
      <ul className="mx-auto flex max-w-xl">
        {shown.map((item) => {
          const active = isActive(path, item);
          return (
            <li key={item.href} className="flex flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={tab(active)}
              >
                <Icon name={item.icon} className={`size-6 ${active ? "" : "opacity-80"}`} />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
        {rest.length ? (
          <li className="relative flex flex-1">
            <details className="group flex flex-1">
              <summary
                className={`${tab(restActive)} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
              >
                <Icon name="more" className="size-6" />
                <span>More</span>
              </summary>
              <ul className="absolute right-2 bottom-16 flex w-56 flex-col rounded-2xl border border-ink/10 bg-white p-2 shadow-lg">
                {rest.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isActive(path, item) ? "page" : undefined}
                      className="flex min-h-11 items-center gap-3 rounded-xl px-3 font-semibold text-ink hover:bg-egg-blue/30"
                    >
                      <Icon name={item.icon} />
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
