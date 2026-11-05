import { describe, expect, it } from "vitest";
import { countSms, isGsm7, toPlainSms } from "./units";

describe("SMS unit counting", () => {
  it("counts an empty message as no units", () => {
    expect(countSms("")).toMatchObject({ units: 0, length: 0, encoding: "GSM-7" });
  });

  it("fits 160 plain characters in one SMS", () => {
    expect(countSms("a".repeat(160))).toMatchObject({ units: 1, encoding: "GSM-7", remaining: 0 });
    expect(countSms("a".repeat(161))).toMatchObject({ units: 2, length: 161 });
  });

  it("splits GSM-7 into parts of 153", () => {
    expect(countSms("a".repeat(306)).units).toBe(2);
    expect(countSms("a".repeat(307)).units).toBe(3);
    expect(countSms("a".repeat(459)).units).toBe(3);
    expect(countSms("a".repeat(200)).remaining).toBe(153 * 2 - 200);
  });

  it("counts Kiswahili and Kenyan punctuation as plain GSM-7", () => {
    const sw = "Bahari Academy: Tumepokea KES 5,000 kwa ajili ya Amina W. (BA/2025/001). Asante!";
    expect(isGsm7(sw)).toBe(true);
    expect(countSms(sw)).toMatchObject({ encoding: "GSM-7", units: 1 });
  });

  it("counts ^ { } [ ] ~ \\ | € as two characters", () => {
    expect(countSms("€").length).toBe(2);
    expect(countSms("{x}").length).toBe(5);
    expect(countSms("€".repeat(80)).units).toBe(1); // 160 septets
    expect(countSms("€".repeat(81)).units).toBe(2);
  });

  it("never splits a two-character symbol across parts", () => {
    // 152 plain + € (2) = 154 septets: the € cannot share part 1, so part 2 starts with it.
    const text = "a".repeat(152) + "€" + "b".repeat(160);
    expect(countSms(text).units).toBe(3);
  });

  it("switches the whole message to Unicode for emoji and curly quotes (70 / 67)", () => {
    expect(countSms("Hello 😊")).toMatchObject({ encoding: "Unicode", units: 1 });
    expect(countSms("’".repeat(70))).toMatchObject({ encoding: "Unicode", units: 1 });
    expect(countSms("’".repeat(71)).units).toBe(2);
    expect(countSms("’".repeat(134)).units).toBe(2);
    expect(countSms("’".repeat(135)).units).toBe(3);
    expect(countSms("It’s ready").unicodeChars).toEqual(["’"]);
  });

  it("counts an emoji as two characters and never splits it", () => {
    expect(countSms("😊").length).toBe(2);
    expect(countSms("😊".repeat(35)).units).toBe(1);
    expect(countSms("😊".repeat(36)).units).toBe(2);
    // 67 emoji = 134 code units: naive 134 / 67 = 2 parts, but each part holds only 33 whole emoji.
    expect(countSms("😊".repeat(67)).units).toBe(3);
  });

  it("replaces look-alike characters with plain ones", () => {
    expect(toPlainSms("It’s “ready” – now…")).toBe('It\'s "ready" - now...');
    expect(isGsm7(toPlainSms("It’s “ready” – now…"))).toBe(true);
  });
});
