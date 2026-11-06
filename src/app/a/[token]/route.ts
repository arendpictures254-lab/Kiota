import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AFTER_SIGN_IN_COOKIE, AFTER_SIGN_IN_PATH } from "@/lib/auth/after-sign-in";
import { readSession, setSessionMode } from "@/lib/auth/session";
import { APP_URL } from "@/lib/hosts";
import { collectorLinkTarget } from "@/lib/leaveout/parent";
import { portalDeps } from "@/lib/portal/context";

/**
 * "Tap to approve" in a leave-out SMS: kiota.app/a/<token>. Nothing is approved by opening the
 * link: the parent signs in as usual (their own phone and code), then sees the request in the
 * portal with Approve and Refuse. The token only finds the leave-out, and only for a parent of
 * that child; anyone else lands on their own portal.
 */
export async function GET(_req: Request, { params }: RouteContext<"/a/[token]">) {
  const { token } = await params;
  const session = await readSession();
  if (!session) {
    // Remembered across sign-in, so the parent lands on the approval afterwards.
    if (AFTER_SIGN_IN_PATH.test(`/a/${token}`)) {
      (await cookies()).set(AFTER_SIGN_IN_COOKIE, `/a/${token}`, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: APP_URL.startsWith("https://"),
        maxAge: 15 * 60,
      });
    }
    return NextResponse.redirect(`${APP_URL}/sign-in`, 303);
  }
  const target = await collectorLinkTarget(portalDeps, session.userId, token);
  if (!target) return NextResponse.redirect(`${APP_URL}/parent`, 303);
  await setSessionMode(session.id, "parent");
  return NextResponse.redirect(
    `${APP_URL}/parent/${target.linkId}/leaveouts#lo-${target.leaveoutId}`,
    303,
  );
}
