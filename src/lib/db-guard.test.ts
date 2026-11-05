import { describe, expect, it } from "vitest";
import { argsHaveSchool, guardEnabled, whereHasSchool } from "./db-guard";

describe("the school-wall guard's rule", () => {
  it("accepts schoolId in any form, a compound key, a school filter or AND", () => {
    expect(whereHasSchool({ schoolId: "a", id: "b" })).toBe(true);
    expect(whereHasSchool({ schoolId: { in: ["a"] } })).toBe(true);
    expect(whereHasSchool({ schoolId: null, key: "director" })).toBe(true);
    expect(whereHasSchool({ schoolId_name: { schoolId: "a", name: "Grade 7" } })).toBe(true);
    expect(whereHasSchool({ school: { id: "a" } })).toBe(true);
    expect(whereHasSchool({ AND: [{ status: "active" }, { schoolId: "a" }] })).toBe(true);
  });

  it("refuses a where without the school", () => {
    expect(whereHasSchool(undefined)).toBe(false);
    expect(whereHasSchool({})).toBe(false);
    expect(whereHasSchool({ id: "b" })).toBe(false);
    expect(whereHasSchool({ schoolId: undefined, id: "b" })).toBe(false);
    expect(whereHasSchool({ OR: [{ schoolId: "a" }, { id: "b" }] })).toBe(false);
    expect(whereHasSchool({ student: { schoolId: "a" } })).toBe(false); // a relation is not enough
  });

  it("checks every row of a create", () => {
    expect(argsHaveSchool("create", { data: { schoolId: "a", name: "x" } })).toBe(true);
    expect(argsHaveSchool("create", { data: { name: "x" } })).toBe(false);
    expect(argsHaveSchool("createMany", { data: [{ schoolId: "a" }, { schoolId: "a" }] })).toBe(
      true,
    );
    expect(argsHaveSchool("createMany", { data: [{ schoolId: "a" }, { name: "x" }] })).toBe(false);
    expect(argsHaveSchool("findMany", undefined)).toBe(false);
    expect(argsHaveSchool("upsert", { where: { id: "b" }, create: {}, update: {} })).toBe(false);
  });

  it("runs in development and tests, never in production", () => {
    expect(guardEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(guardEnabled({ NODE_ENV: "test" })).toBe(true);
    expect(guardEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(guardEnabled({ NODE_ENV: "development", KIOTA_DB_GUARD: "off" })).toBe(false);
  });
});
