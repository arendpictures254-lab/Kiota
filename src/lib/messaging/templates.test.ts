import { describe, expect, it } from "vitest";
import { inQuietHours, nextSendTime, quietHours } from "./quiet-hours";
import { pickTemplate, renderTemplate, renderWhatsAppBody, whatsappParams } from "./templates";

describe("templates", () => {
  it("fills placeholders and leaves out optional parts with missing values", () => {
    const body = "{school}: balance {balance}[[ due by {due_date}]].[[ Paybill {paybill}.]]";
    expect(
      renderTemplate(body, { school: "Bahari", balance: "KES 500", due_date: "15 Jan 2027" }),
    ).toBe("Bahari: balance KES 500 due by 15 Jan 2027.");
    expect(
      renderTemplate(body, { school: "Bahari", balance: "KES 500", due_date: null, paybill: "" }),
    ).toBe("Bahari: balance KES 500.");
  });

  it("picks the guardian's language, else English", () => {
    const ts = [
      { key: "notice", language: "en" as const, id: 1 },
      { key: "notice", language: "sw" as const, id: 2 },
      { key: "fee_reminder", language: "en" as const, id: 3 },
    ];
    expect(pickTemplate(ts, "notice", "sw")?.id).toBe(2);
    expect(pickTemplate(ts, "fee_reminder", "sw")?.id).toBe(3);
    expect(pickTemplate(ts, "nothing", "en")).toBeNull();
  });

  it("builds WhatsApp parameters in order, never blank", () => {
    const t = { whatsappParams: ["school", "student", "balance"] };
    const params = whatsappParams(t, { school: "Bahari", student: "Amina W.", balance: "" });
    expect(params).toEqual(["Bahari", "Amina W.", "-"]);
    expect(renderWhatsAppBody("{{1}}: {{2}} owes {{3}}", params)).toBe("Bahari: Amina W. owes -");
  });
});

describe("quiet hours (21:00 to 07:00 Nairobi)", () => {
  const at = (iso: string) => new Date(iso);
  const q = quietHours("21-7");

  it("knows when it is quiet", () => {
    expect(inQuietHours(at("2027-01-15T17:59:00Z"), q)).toBe(false); // 20:59 Nairobi
    expect(inQuietHours(at("2027-01-15T18:00:00Z"), q)).toBe(true); // 21:00
    expect(inQuietHours(at("2027-01-15T03:59:00Z"), q)).toBe(true); // 06:59
    expect(inQuietHours(at("2027-01-15T04:00:00Z"), q)).toBe(false); // 07:00
  });

  it("holds non-critical messages until 07:00 and lets critical ones go", () => {
    // 22:30 Nairobi on the 15th -> 07:00 Nairobi on the 16th (04:00 UTC).
    expect(nextSendTime(at("2027-01-15T19:30:00Z"), false, q).toISOString()).toBe(
      "2027-01-16T04:00:00.000Z",
    );
    // 05:00 Nairobi -> 07:00 the same day.
    expect(nextSendTime(at("2027-01-16T02:00:00Z"), false, q).toISOString()).toBe(
      "2027-01-16T04:00:00.000Z",
    );
    const late = at("2027-01-15T19:30:00Z");
    expect(nextSendTime(late, true, q)).toBe(late);
    const noon = at("2027-01-15T09:00:00Z");
    expect(nextSendTime(noon, false, q)).toBe(noon);
  });

  it("can be switched off (end-to-end tests)", () => {
    expect(quietHours("off")).toBeNull();
    expect(inQuietHours(at("2027-01-15T19:30:00Z"), null)).toBe(false);
  });
});
