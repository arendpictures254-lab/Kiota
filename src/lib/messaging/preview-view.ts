/**
 * The cost preview as shown on screen (plain strings, safe to send to the browser).
 * No server-only imports: the client form imports the types.
 */
import { kes } from "@/lib/fees/allocation";

export type PreviewView = {
  recipients: number;
  units: number;
  messagesText: string;
  costCents: number;
  costText: string;
  balanceText: string;
  balanceAfterText: string;
  enough: boolean;
  waitsForMorning: boolean;
  sample: string | null;
  note?: string | null;
};

export type SendState = { error?: string; field?: string; ok?: string; preview?: PreviewView };

export function toPreviewView(
  p: {
    recipients: number;
    sms: number;
    whatsapp: number;
    units: number;
    costCents: number;
    balanceCents: number;
    balanceAfterCents: number;
    enough: boolean;
    waitsForMorning: boolean;
    sample: string | null;
  },
  note?: string | null,
): PreviewView {
  const parts = [
    p.sms ? `${p.sms} SMS` : null,
    p.whatsapp ? `${p.whatsapp} WhatsApp` : null,
  ].filter(Boolean);
  return {
    recipients: p.recipients,
    units: p.units,
    messagesText: parts.join(" + ") || "0",
    costCents: p.costCents,
    costText: kes(p.costCents),
    balanceText: kes(p.balanceCents),
    balanceAfterText: kes(p.balanceAfterCents),
    enough: p.enough,
    waitsForMorning: p.waitsForMorning,
    sample: p.sample,
    note: note ?? null,
  };
}
