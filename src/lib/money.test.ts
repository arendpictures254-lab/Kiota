import { describe, expect, it } from "vitest";
import { formatKes } from "./money";

describe("formatKes", () => {
  it("formats integer cents as shillings", () => {
    expect(formatKes(1_250_050)).toBe("KES 12,500.50");
    expect(formatKes(0)).toBe("KES 0.00");
    expect(formatKes(-500)).toBe("-KES 5.00");
  });

  it("rejects non-integer amounts", () => {
    expect(() => formatKes(10.5)).toThrow();
  });
});
