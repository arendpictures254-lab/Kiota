import { describe, expect, it } from "vitest";
import { en } from "./en";
import { translator } from "./index";
import { sw } from "./sw";

describe("parent portal translations", () => {
  it("has every English string in Kiswahili, with the same placeholders", () => {
    expect(Object.keys(sw).sort()).toEqual(Object.keys(en).sort());
    const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(holes(sw[key]), key).toEqual(holes(en[key]));
      expect(sw[key].trim(), key).not.toBe("");
    }
  });

  it("fills placeholders in the chosen language", () => {
    expect(translator("en")("pending.card", { school: "Milima School", child: "Joy" })).toBe(
      "Milima School wants to add Joy to your account.",
    );
    expect(translator("sw")("pending.card", { school: "Milima School", child: "Joy" })).toBe(
      "Milima School inataka kumwongeza Joy kwenye akaunti yako.",
    );
  });

  it("tells an unknown number to contact the school, in both languages", () => {
    expect(translator("en")("signin.unknown")).toBe(
      "Your school hasn't added this number yet. Please contact the school.",
    );
    expect(translator("sw")("signin.unknown")).toMatch(/wasiliana na shule/);
  });
});
