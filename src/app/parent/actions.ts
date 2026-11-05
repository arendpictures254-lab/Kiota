"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/context";
import { createOtpService } from "@/lib/auth/otp";
import { platformDb } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { MAX_STK_SHILLINGS } from "@/lib/mpesa/service";
import {
  PayInputError,
  PortalCodeError,
  confirmLink,
  declineLink,
  markNoticeRead,
  myChildren,
  requestConfirmCode,
  startPayment,
} from "@/lib/portal/service";
import { ValidationError } from "@/lib/service-kit";
import { sendPlatformSms } from "@/lib/sms";

const deps = { db: platformDb };

function otp() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return createOtpService({ db: platformDb, sendSms: sendPlatformSms, secret });
}

export async function markReadAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const linkId = String(form.get("linkId") ?? "");
  await markNoticeRead(deps, user.id, String(form.get("campaignId") ?? ""));
  revalidatePath(`/parent/${linkId}/notices`);
  revalidatePath("/parent");
}

export type ConfirmState = { step: "start" | "code"; error?: string; message?: string };

/** Step 1 sends a fresh code to the parent's own phone; step 2 checks it and confirms. */
export async function confirmLinkAction(prev: ConfirmState, form: FormData): Promise<ConfirmState> {
  const user = await requireUser();
  const { t } = await getT();
  const linkId = String(form.get("linkId") ?? "");
  const child = (await myChildren(deps, user.id)).find((c) => c.linkId === linkId);
  try {
    if (form.get("intent") !== "confirm") {
      await requestConfirmCode(deps, otp(), user, linkId);
      return { step: "code", message: t("signin.sent") };
    }
    await confirmLink(deps, otp(), user, linkId, String(form.get("code") ?? ""));
  } catch (err) {
    if (err instanceof PortalCodeError) {
      const error =
        err.reason === "wrong_code"
          ? err.attemptsLeft === 1
            ? t("signin.wrongOne")
            : err.attemptsLeft
              ? t("signin.wrongMany", { n: err.attemptsLeft })
              : t("signin.expired")
          : err.reason === "too_many_attempts"
            ? t("signin.tooMany")
            : err.reason === "rate_limited"
              ? t("signin.rateLimited")
              : t("signin.expired");
      return {
        step: prev.step === "start" && err.reason === "rate_limited" ? "start" : "code",
        error,
      };
    }
    if (err instanceof ValidationError) return { step: "start", error: t("pending.gone") };
    throw err;
  }
  revalidatePath("/parent", "layout");
  redirect(`/parent/${linkId}?added=${encodeURIComponent(child?.firstName ?? "")}`);
}

export async function declineLinkAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const linkId = String(form.get("linkId") ?? "");
  const child = (await myChildren(deps, user.id)).find((c) => c.linkId === linkId);
  try {
    await declineLink(deps, user.id, linkId);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
  }
  revalidatePath("/parent", "layout");
  redirect(`/parent?declined=${encodeURIComponent(child?.schoolName ?? "")}`);
}

export type PayState = { error?: string; field?: string };

export async function payAction(_prev: PayState, form: FormData): Promise<PayState> {
  const user = await requireUser();
  const { t } = await getT();
  const linkId = String(form.get("linkId") ?? "");
  let transactionId: string;
  try {
    ({ transactionId } = await startPayment(deps, user, linkId, {
      amount: form.get("amount"),
      phone: form.get("phone"),
    }));
  } catch (err) {
    if (err instanceof PayInputError) {
      return err.field === "phone"
        ? { error: t("pay.badPhone"), field: "phone" }
        : {
            error: t("pay.badAmount", { max: MAX_STK_SHILLINGS.toLocaleString("en-KE") }),
            field: "amount",
          };
    }
    if (err instanceof ValidationError) {
      return { error: err.message === "no_mpesa" ? t("fees.noMpesa") : t("child.notFound") };
    }
    throw err;
  }
  redirect(`/parent/${linkId}/pay/${transactionId}`);
}
