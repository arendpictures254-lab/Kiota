import { describe, expect, it } from "vitest";
import { homeFor } from "./service";

const base = { staffSchools: 0, isPlatformAdmin: false, hasChildren: false, mode: null } as const;

describe("where people land after signing in", () => {
  it("sends a parent to the portal and staff to their school", () => {
    expect(homeFor({ ...base, hasChildren: true })).toBe("/parent");
    expect(homeFor({ ...base, staffSchools: 1 })).toBe("/dashboard");
    expect(homeFor({ ...base, staffSchools: 2 })).toBe("/schools");
    expect(homeFor({ ...base, isPlatformAdmin: true })).toBe("/admin");
  });

  it("asks someone who is both staff and a parent, then remembers the choice", () => {
    const both = { ...base, staffSchools: 1, hasChildren: true };
    expect(homeFor(both)).toBe("/choose");
    expect(homeFor({ ...both, mode: "parent" })).toBe("/parent");
    expect(homeFor({ ...both, mode: "staff" })).toBe("/dashboard");
    expect(homeFor({ ...both, staffSchools: 2, mode: "staff" })).toBe("/schools");
  });

  it("ignores a parent mode for someone who has no children", () => {
    expect(homeFor({ ...base, staffSchools: 1, mode: "parent" })).toBe("/dashboard");
  });
});
