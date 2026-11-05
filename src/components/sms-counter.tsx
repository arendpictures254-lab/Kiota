"use client";

import { kes } from "@/lib/fees/allocation";
import { countSms } from "@/lib/messaging/units";

/**
 * Live SMS count under a message box: characters, units per parent and the price. Warns when
 * the message needs more than one SMS, and names the characters that force Unicode.
 */
export function SmsCounter({
  text,
  prefix = "",
  unitPriceCents,
  id,
}: {
  text: string;
  /** Added before the text when sent (e.g. "Bahari Academy: "), so it counts too. */
  prefix?: string;
  unitPriceCents: number;
  id?: string;
}) {
  const c = countSms(prefix + text);
  const over = c.units > 1;
  return (
    <div id={id} aria-live="polite" className="flex flex-col gap-1 text-sm">
      <p className={over ? "font-semibold text-status-due" : "text-ink/60"}>
        {c.length} characters · {c.units} SMS per parent · {kes(c.units * unitPriceCents)} each
        {c.units ? ` · ${c.remaining} left in this SMS` : ""}
      </p>
      {over ? (
        <p className="text-status-due">
          This is longer than one SMS, so each parent costs {c.units} times as much. Shorten it to
          fit {c.encoding === "GSM-7" ? 160 : 70} characters for one SMS.
        </p>
      ) : null}
      {c.encoding === "Unicode" ? (
        <p className="text-ink/70">
          {c.unicodeChars
            .slice(0, 5)
            .map((ch) => `“${ch}”`)
            .join(" ")}{" "}
          {c.unicodeChars.length === 1 ? "is a special character" : "are special characters"}: one
          SMS then holds only 70 characters. Use plain letters and &apos; quotes to fit 160.
        </p>
      ) : null}
    </div>
  );
}
