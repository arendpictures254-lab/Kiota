import { describe, expect, it } from "vitest";
import { BUILT_IN_ROLES, DIRECTOR_GRANT_ONLY, PERMISSIONS } from "./catalog";
import { ForbiddenError, assertCan, can, canGrant, effectivePermissions } from "./permissions";

const role = (key: string) => BUILT_IN_ROLES.find((r) => r.key === key)!.permissions;

describe("built-in roles", () => {
  it("seeds the nine school roles", () => {
    expect(BUILT_IN_ROLES.map((r) => r.key)).toEqual([
      "director",
      "principal",
      "bursar",
      "accounts_clerk",
      "class_teacher",
      "subject_teacher",
      "boarding_master",
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
    expect(can(p, "payments.record")).toBe(false);
    expect(can(p, "payments.reverse")).toBe(false);
    expect(can(p, "fees.manage")).toBe(false);
  });

  it("let the accounts clerk record payments but not reverse them", () => {
    const p = effectivePermissions({ rolePermissions: role("accounts_clerk"), grants: [] });
    expect(can(p, "payments.record")).toBe(true);
    expect(can(p, "payments.reverse")).toBe(false);
    expect(can(p, "fees.manage")).toBe(false);
  });
});

describe("effectivePermissions", () => {
  it("combines several roles and direct grants", () => {
    const p = effectivePermissions({
      rolePermissions: [...role("bursar"), ...role("class_teacher")],
      grants: ["leaveout.approve"],
    });
    expect(can(p, "payments.reverse")).toBe(true);
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
    expect(canGrant(director, "payments.reverse")).toBe(false);
    expect(canGrant(director, "staff.manage")).toBe(false);
    expect(canGrant(director, "not.a.permission")).toBe(false);
  });
});
