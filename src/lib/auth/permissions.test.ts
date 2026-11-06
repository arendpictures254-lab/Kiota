import { describe, expect, it } from "vitest";
import { BUILT_IN_ROLES, DIRECTOR_GRANT_ONLY, PERMISSIONS } from "./catalog";
import { ForbiddenError, assertCan, can, canGrant, effectivePermissions } from "./permissions";

const role = (key: string) => BUILT_IN_ROLES.find((r) => r.key === key)!.permissions;

describe("built-in roles", () => {
  it("seeds the eleven school roles people can be given", () => {
    expect(BUILT_IN_ROLES.filter((r) => !r.hidden).map((r) => r.key)).toEqual([
      "director",
      "principal",
      "bursar",
      "accounts_clerk",
      "class_teacher",
      "subject_teacher",
      "boarding_master",
      "matron",
      "secretary",
      "storekeeper",
      "gate_guard",
    ]);
  });

  it("only use permissions from the catalogue", () => {
    for (const r of BUILT_IN_ROLES) {
      for (const p of r.permissions) expect(PERMISSIONS, `${r.key}: ${p}`).toHaveProperty([p]);
    }
  });

  it("give leave-out approval and the right to grant it only to the Director", () => {
    for (const r of BUILT_IN_ROLES) {
      const isDirector = r.key === "director";
      expect(r.permissions.includes("leaveout.approve"), r.key).toBe(isDirector);
      expect(r.permissions.includes("leaveout.grant"), r.key).toBe(isDirector);
    }
  });

  it("do not let the principal edit money records", () => {
    const p = effectivePermissions({ rolePermissions: role("principal"), grants: [] });
    expect(can(p, "fees.view")).toBe(true);
    expect(can(p, "fees.collect")).toBe(false);
    expect(can(p, "fees.reverse")).toBe(false);
    expect(can(p, "fees.setup")).toBe(false);
  });

  it("give fee setup to the Director and Bursar, reversals to the Bursar only", () => {
    const has = (key: string, perm: Parameters<typeof can>[1]) =>
      can(effectivePermissions({ rolePermissions: role(key), grants: [] }), perm);
    expect(has("bursar", "fees.setup")).toBe(true);
    expect(has("director", "fees.setup")).toBe(true);
    expect(has("accounts_clerk", "fees.setup")).toBe(false);
    expect(has("bursar", "fees.reverse")).toBe(true);
    expect(has("accounts_clerk", "fees.reverse")).toBe(false);
    expect(has("principal", "fees.reverse")).toBe(false);
    for (const r of ["director", "principal", "bursar"])
      expect(has(r, "fees.reports"), r).toBe(true);
    expect(has("accounts_clerk", "fees.reports")).toBe(false);
  });

  it("keep the automatic payments role hidden and limited to collecting", () => {
    const sys = BUILT_IN_ROLES.find((r) => r.key === "system_payments")!;
    expect(sys.hidden).toBe(true);
    expect([...sys.permissions].sort()).toEqual(["fees.collect", "fees.view", "students.view"]);
  });

  it("let the accounts clerk record payments but not reverse them", () => {
    const p = effectivePermissions({ rolePermissions: role("accounts_clerk"), grants: [] });
    expect(can(p, "fees.collect")).toBe(true);
    expect(can(p, "fees.reverse")).toBe(false);
    expect(can(p, "fees.setup")).toBe(false);
  });
});

describe("effectivePermissions", () => {
  it("combines several roles and direct grants", () => {
    const p = effectivePermissions({
      rolePermissions: [...role("bursar"), ...role("class_teacher")],
      grants: ["leaveout.approve"],
    });
    expect(can(p, "fees.reverse")).toBe(true);
    expect(can(p, "marks.enter")).toBe(true);
    expect(can(p, "leaveout.approve")).toBe(true);
    expect(can(p, "staff.manage")).toBe(false);
  });

  it("ignores unknown permission keys", () => {
    const p = effectivePermissions({ rolePermissions: ["root.everything"], grants: [] });
    expect(p.size).toBe(0);
  });

  it("assertCan throws ForbiddenError when missing", () => {
    const p = effectivePermissions({ rolePermissions: role("gate_guard"), grants: [] });
    expect(() => assertCan(p, "gate.scan")).not.toThrow();
    expect(() => assertCan(p, "staff.manage")).toThrow(ForbiddenError);
  });
});

describe("canGrant", () => {
  const director = effectivePermissions({ rolePermissions: role("director"), grants: [] });
  const principalWithApproval = effectivePermissions({
    rolePermissions: role("principal"),
    grants: ["leaveout.approve"],
  });

  it("lets the Director grant leave-out approval", () => {
    expect(canGrant(director, "leaveout.approve")).toBe(true);
  });

  it("does not let someone who can approve leave-outs pass that on", () => {
    expect(can(principalWithApproval, "leaveout.approve")).toBe(true);
    expect(canGrant(principalWithApproval, "leaveout.approve")).toBe(false);
  });

  it("only allows director-grant-only permissions to be granted one by one", () => {
    expect(DIRECTOR_GRANT_ONLY).toEqual(["leaveout.approve"]);
    expect(canGrant(director, "fees.reverse")).toBe(false);
    expect(canGrant(director, "staff.manage")).toBe(false);
    expect(canGrant(director, "not.a.permission")).toBe(false);
  });
});
