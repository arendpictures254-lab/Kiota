import "server-only";

import { notFound, redirect } from "next/navigation";
import { listMySchools, requireUser } from "@/lib/auth/context";
import { platformDb } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { myChild, myChildren } from "./service";

export const portalDeps = { db: platformDb };

/** For parent pages: the signed-in parent, their children and their language. */
export async function requireParent() {
  const user = await requireUser();
  const [children, schools, { t, locale }] = await Promise.all([
    myChildren(portalDeps, user.id),
    listMySchools(user.id),
    getT(),
  ]);
  const isStaff = schools.length > 0 || user.isPlatformAdmin;
  if (children.length === 0) redirect(isStaff ? "/schools" : "/sign-in");
  return { user, children, isStaff, t, locale };
}

/** For a child's pages: one of this parent's live (confirmed) children, or 404. */
export async function requireChild(linkId: string) {
  const p = await requireParent();
  const child = await myChild(portalDeps, p.user.id, linkId);
  if (!child) notFound();
  return { ...p, child };
}
