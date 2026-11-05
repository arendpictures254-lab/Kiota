import { describe, expect, it } from "vitest";
import { parseDate } from "@/lib/service-kit";
import {
  dateOfBirthProblem,
  guardianDefaults,
  parseBoarding,
  parseGender,
  parseKesToCents,
  parseLanguage,
  parseRelationship,
  parseYesNo,
} from "./rules";

describe("parseKesToCents", () => {
  it.each([
    ["12500", 1_250_000],
    ["12,500.50", 1_250_050],
    ["KES 1,200", 120_000],
    ["Ksh. 300", 30_000],
    ["-500", -50_000],
    ["(500)", -50_000],
    ["0", 0],
    [12500.5, 1_250_050],
  ])("%s -> %i cents", (input, cents) => {
    expect(parseKesToCents(input)).toEqual({ cents });
  });

  it("treats blank as no balance", () => {
    expect(parseKesToCents("")).toEqual({ cents: null });
    expect(parseKesToCents(null)).toEqual({ cents: null });
  });

  it.each(["twelve", "12.555", "1.2.3", "12,5OO"])("rejects %s", (input) => {
    expect(parseKesToCents(input)).toHaveProperty("error");
  });
});

describe("dateOfBirthProblem", () => {
  const today = new Date("2026-12-01T00:00:00Z");
  it("accepts school-age children", () => {
    expect(dateOfBirthProblem(new Date("2014-03-14"), today)).toBeNull();
    expect(dateOfBirthProblem(new Date("2022-01-01"), today)).toBeNull();
  });
  it("rejects impossible dates", () => {
    expect(dateOfBirthProblem(new Date("2027-01-01"), today)).toMatch(/future/);
    expect(dateOfBirthProblem(new Date("2026-01-01"), today)).toMatch(/younger than 2/);
    expect(dateOfBirthProblem(new Date("1990-01-01"), today)).toMatch(/older than 25/);
  });
});

describe("parseDate", () => {
  it("reads Kenyan day-first dates and ISO dates", () => {
    expect(parseDate("14/03/2014")?.toISOString()).toBe("2014-03-14T00:00:00.000Z");
    expect(parseDate("4-3-2014")?.toISOString()).toBe("2014-03-04T00:00:00.000Z");
    expect(parseDate("2014-03-14")?.toISOString()).toBe("2014-03-14T00:00:00.000Z");
  });
  it("rejects dates that do not exist", () => {
    expect(parseDate("31/02/2014")).toBeNull();
    expect(parseDate("14/13/2014")).toBeNull();
    expect(parseDate("yesterday")).toBeNull();
  });
});

describe("value parsers", () => {
  it("understand common spellings", () => {
    expect(parseGender("F")).toBe("female");
    expect(parseGender("boy")).toBe("male");
    expect(parseGender("x")).toBeNull();
    expect(parseBoarding("Boarder")).toBe(true);
    expect(parseBoarding("day scholar")).toBe(false);
    expect(parseBoarding("sometimes")).toBeNull();
    expect(parseRelationship("Mum")).toBe("mother");
    expect(parseRelationship("Sponsor")).toBe("sponsor");
    expect(parseRelationship("uncle")).toBeNull();
    expect(parseLanguage("")).toBe("en");
    expect(parseLanguage("Kiswahili")).toBe("sw");
    expect(parseLanguage("French")).toBeNull();
    expect(parseYesNo("", true)).toBe(true);
    expect(parseYesNo("No", true)).toBe(false);
    expect(parseYesNo("Ndiyo", false)).toBe(true);
    expect(parseYesNo("maybe", true)).toBeNull();
  });

  it("sponsors receive fee messages only by default", () => {
    expect(guardianDefaults("sponsor")).toEqual({
      receivesFees: true,
      receivesAcademics: false,
      receivesBoarding: false,
      authorisedToCollect: false,
      whatsapp: false,
    });
    expect(guardianDefaults("mother").authorisedToCollect).toBe(true);
  });
});
