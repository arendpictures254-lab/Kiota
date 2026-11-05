"use client";

import { useState } from "react";
import { SendConfirmForm } from "@/components/send-confirm-form";
import { SmsCounter } from "@/components/sms-counter";
import { Checkbox } from "@/components/ui";
import { noticeAction } from "../actions";

const control =
  "rounded-xl border border-ink/20 bg-white px-4 text-base text-ink outline-none focus:border-teal focus:ring-2 focus:ring-teal/30";

export function NoticeComposer({
  groups,
  topics,
  prefix,
  smsUnitPriceCents,
  maxChars,
  whatsapp,
}: {
  groups: { label: string; options: { value: string; label: string }[] }[];
  topics: { value: string; label: string }[];
  prefix: string;
  smsUnitPriceCents: number;
  maxChars: number;
  whatsapp: boolean;
}) {
  const [message, setMessage] = useState("");
  const [messageSw, setMessageSw] = useState("");
  const [showSw, setShowSw] = useState(false);

  return (
    <SendConfirmForm action={noticeAction}>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="audience" className="text-sm font-semibold text-ink">
          Send to
        </label>
        <select
          id="audience"
          name="audience"
          required
          defaultValue=""
          className={`h-12 ${control}`}
        >
          <option value="" disabled>
            Choose who gets it
          </option>
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="message" className="text-sm font-semibold text-ink">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          rows={4}
          required
          maxLength={maxChars}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          aria-describedby="message-count"
          className={`py-3 ${control}`}
        />
        <p className="text-sm text-ink/60">Parents see it as “{prefix}…”</p>
        <SmsCounter
          id="message-count"
          text={message}
          prefix={prefix}
          unitPriceCents={smsUnitPriceCents}
        />
      </div>

      {showSw ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="messageSw" className="text-sm font-semibold text-ink">
            Kiswahili version (for parents who chose Kiswahili)
          </label>
          <textarea
            id="messageSw"
            name="messageSw"
            rows={4}
            maxLength={maxChars}
            value={messageSw}
            onChange={(e) => setMessageSw(e.target.value)}
            className={`py-3 ${control}`}
          />
          <SmsCounter text={messageSw} prefix={prefix} unitPriceCents={smsUnitPriceCents} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowSw(true)}
          className="self-start text-sm font-semibold text-teal"
        >
          + Add a Kiswahili version
        </button>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="topic" className="text-sm font-semibold text-ink">
          Topic
        </label>
        <select id="topic" name="topic" defaultValue="general" className={`h-12 ${control}`}>
          {topics.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <p className="text-sm text-ink/60">Parents only get topics they chose to receive.</p>
      </div>

      {whatsapp ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="channel" className="text-sm font-semibold text-ink">
            Send by
          </label>
          <select id="channel" name="channel" defaultValue="sms" className={`h-12 ${control}`}>
            <option value="sms">SMS</option>
            <option value="whatsapp">WhatsApp (SMS for parents without it)</option>
          </select>
        </div>
      ) : (
        <input type="hidden" name="channel" value="sms" />
      )}

      <Checkbox
        name="critical"
        label="Emergency"
        description="Sends at once, even during quiet hours (21:00 to 07:00) and when the wallet is empty, within the small overdraft Arend Studio allows."
      />
    </SendConfirmForm>
  );
}
