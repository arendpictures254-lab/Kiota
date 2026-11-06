import { describe, expect, it } from "vitest";
import { BUILT_IN_ROLES } from "@/lib/auth/catalog";
import { effectivePermissions } from "@/lib/auth/permissions";
import type { Actor } from "@/lib/service-kit";
import { app, makeMember, makeSchool, makeStream, makeStudent } from "../../../tests/db-helpers";
import { dashboardOverview } from "./service";

const deps = { db: app };

async function member(schoolId: string, role: string): Promise<Actor> {
  const m = await makeMember(schoolId, [role], role);
  return {
    userId: m.user.id,
    schoolId,
    permissions: effectivePermissions({
      rolePermissions: BUILT_IN_ROLES.find((r) => r.key === role)!.permissions,
      grants: [],
    }),
  };
}

describe("dashboard overview", () => {
  it("shows each part only to people with the permission behind it", async () => {
    const school = await makeSchool(`Dashboard ${Date.now()}`);
    const stream = await makeStream(school.id, "Grade 7", "East");
    await makeStudent(school.id, stream.id);
    await makeStudent(school.id, stream.id);
    const director = await dashboardOverview(deps, await member(school.id, "director"));
    expect(director.studentCount).toBe(2);
    expect(director.staffCount).toBeGreaterThanOrEqual(1);
    expect(director.payments).toEqual([]);
    expect(director.wallet).not.toBeNull();
    expect(director.notices).toEqual([]);

    // A subject teacher: no money, no staff, no wallet.
    const teacher = await dashboardOverview(deps, await member(school.id, "subject_teacher"));
    expect(teacher.payments).toBeUndefined();
    expect(teacher.fees).toBeNull();
    expect(teacher.wallet).toBeNull();
    expect(teacher.staffCount).toBeNull();

    // A bursar sees payments but not the staff list.
    const bursar = await dashboardOverview(deps, await member(school.id, "bursar"));
    expect(bursar.payments).toEqual([]);
    expect(bursar.staffCount).toBeNull();
  });

  it("never counts another school's students", async () => {
    const a = await makeSchool(`Dashboard A ${Date.now()}`);
    const b = await makeSchool(`Dashboard B ${Date.now()}`);
    const stream = await makeStream(a.id, "Grade 7", "East");
    await makeStudent(a.id, stream.id);
    const directorB = await dashboardOverview(deps, await member(b.id, "director"));
    expect(directorB.studentCount).toBe(0);
    // Even with school A's id, a school B director sees nothing: row-level security.
    const sneaky = await dashboardOverview(deps, {
      ...(await member(b.id, "director")),
      schoolId: a.id,
    });
    expect(sneaky.studentCount).toBe(0);
    expect(sneaky.staffCount).toBe(0);
  });
});
