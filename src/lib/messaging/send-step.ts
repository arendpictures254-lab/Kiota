import "server-only";

import { ForbiddenError } from "@/lib/auth/permissions";
import { ValidationError } from "@/lib/service-kit";
import { type SendState, toPreviewView } from "./preview-view";
import { CostChangedError } from "./service";

/** For send actions (notices, fee reminders): expected errors become a message on the form. */
export async function sendStep(fn: () => Promise<SendState>): Promise<SendState> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CostChangedError)
      return { error: err.message, preview: toPreviewView(err.preview) };
    if (err instanceof ForbiddenError) return { error: "You don't have permission to do that." };
    if (err instanceof ValidationError) return { error: err.message, field: err.field };
    throw err;
  }
}
