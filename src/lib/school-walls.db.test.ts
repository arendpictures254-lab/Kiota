/**
 * School walls: proves PostgreSQL row-level security keeps each school's data apart,
 * even when app code makes a mistake or uses raw SQL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scopedDb, withContext } from "@/lib/db-core";
import { app, makeAdmin, makeMember, makeSchool, owner } from "../../tests/db-helpers";

let schoolA: { id: string };
let schoolB: { id: string };
let userA: { id: string };
let memberB: { id: string };
let userB: { id: string };

beforeAll(async () => {
  schoolA = await makeSchool(`Wall A ${Date.now()}`);
  schoolB = await makeSchool(`Wall B ${Date.now()}`);
  const a = await makeMember(schoolA.id, ["director"], "Director A");
  const b = await makeMember(schoolB.id, ["director"], "Director B");
  userA = a.user;
  userB = b.user;
  memberB = b.membership;
  await owner.auditLog.create({
    data: { schoolId: schoolB.id, actorId: userB.id, action: "test.secret", targetType: "x" },
  });
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

const ctxA = () => ({ userId: userA.id, schoolId: schoolA.id });

describe("the app database role", () => {
  it("is not a superuser, does not own the tables and cannot bypass RLS", async () => {
    const [row] = await app.$queryRaw<
      { current_user: string; rolsuper: boolean; rolbypassrls: boolean; owns: boolean }[]
    >`SELECT current_user,
             r.rolsuper,
             r.rolbypassrls,
             EXISTS (SELECT 1 FROM pg_tables t WHERE t.tableowner = current_user) AS owns
      FROM pg_roles r WHERE r.rolname = current_user`;
    expect(row.current_user).toBe("kiota_app");
    expect(row.rolsuper).toBe(false);
    expect(row.rolbypassrls).toBe(false);
    expect(row.owns).toBe(false);
  });

  it("has FORCE ROW LEVEL SECURITY on every school-owned table", async () => {
    const tables = [
      "schools",
      "users",
      "memberships",
      "roles",
      "role_permissions",
      "membership_roles",
      "permission_grants",
      "audit_logs",
    ];
    const rows = await owner.$queryRaw<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname = ANY(${tables}) AND relkind = 'r'`;
    expect(rows).toHaveLength(tables.length);
    for (const r of rows) {
      expect(r, r.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    }
  });

  it("every table with a school_id column has row-level security", async () => {
    const rows = await owner.$queryRaw<{ table_name: string; rls: boolean }[]>`
      SELECT c.table_name, cls.relforcerowsecurity AS rls
      FROM information_schema.columns c
      JOIN pg_class cls ON cls.relname = c.table_name AND cls.relkind = 'r'
      WHERE c.table_schema = 'public' AND c.column_name = 'school_id'
        AND c.table_name <> 'sessions'`;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.rls, r.table_name).toBe(true);
  });
});

describe("a user in School A", () => {
  it("can read their own school's rows", async () => {
    const memberships = await scopedDb(app, ctxA()).membership.findMany();
    expect(memberships.length).toBeGreaterThan(0);
    expect(memberships.every((m) => m.schoolId === schoolA.id)).toBe(true);
  });

  it("cannot read School B's rows, even when asking for them by id", async () => {
    const db = scopedDb(app, ctxA());
    expect(await db.membership.findMany({ where: { schoolId: schoolB.id } })).toEqual([]);
    expect(await db.membership.findUnique({ where: { id: memberB.id } })).toBeNull();
    expect(await db.school.findUnique({ where: { id: schoolB.id } })).toBeNull();
    expect(await db.user.findUnique({ where: { id: userB.id }, select: { id: true } })).toBeNull();
    expect(await db.auditLog.findMany({ where: { schoolId: schoolB.id } })).toEqual([]);
  });

  it("cannot read School B's rows through a raw query", async () => {
    const db = scopedDb(app, ctxA());
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM memberships WHERE school_id = ${schoolB.id}::uuid`;
    expect(rows).toEqual([]);
    const audit = await db.$queryRawUnsafe<unknown[]>(
      `SELECT * FROM audit_logs WHERE school_id = '${schoolB.id}'`,
    );
    expect(audit).toEqual([]);
  });

  it("cannot update or delete School B's rows", async () => {
    await withContext(app, ctxA(), async (tx) => {
      const updated = await tx.membership.updateMany({
        where: { id: memberB.id },
        data: { status: "removed" },
      });
      expect(updated.count).toBe(0);
      const deleted = await tx.membership.deleteMany({ where: { schoolId: schoolB.id } });
      expect(deleted.count).toBe(0);
      const raw = await tx.$executeRaw`
        UPDATE schools SET name = 'hacked' WHERE id = ${schoolB.id}::uuid`;
      expect(raw).toBe(0);
      const rawDelete = await tx.$executeRaw`
        DELETE FROM membership_roles WHERE school_id = ${schoolB.id}::uuid`;
      expect(rawDelete).toBe(0);
    });
    const still = await owner.membership.findUniqueOrThrow({ where: { id: memberB.id } });
    expect(still.status).toBe("active");
    expect((await owner.school.findUniqueOrThrow({ where: { id: schoolB.id } })).name).not.toBe(
      "hacked",
    );
    expect(await owner.membershipRole.count({ where: { schoolId: schoolB.id } })).toBe(1);
  });

  it("cannot insert rows into School B", async () => {
    await expect(
      withContext(app, ctxA(), (tx) =>
        tx.membership.create({
          data: { schoolId: schoolB.id, userId: userA.id, displayName: "Intruder" },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("sees nothing when it claims to be in School B (forged school id)", async () => {
    const db = scopedDb(app, { userId: userA.id, schoolId: schoolB.id });
    expect(await db.membership.findMany()).toEqual([]);
    expect(await db.school.findMany()).toEqual([]);
    expect(await db.$queryRaw<unknown[]>`SELECT * FROM memberships`).toEqual([]);
  });
});

describe("a request with no school set", () => {
  it("sees no school rows at all", async () => {
    for (const db of [app, scopedDb(app, { userId: userA.id, schoolId: null })]) {
      expect(await db.membership.findMany()).toEqual([]);
      expect(await db.membershipRole.findMany()).toEqual([]);
      expect(await db.permissionGrant.findMany()).toEqual([]);
      expect(await db.auditLog.findMany({ where: { schoolId: { not: null } } })).toEqual([]);
      expect(await db.$queryRaw<unknown[]>`SELECT * FROM memberships`).toEqual([]);
    }
    expect(await app.school.findMany()).toEqual([]);
    expect(await app.user.findMany({ select: { id: true } })).toEqual([]);
  });
});

describe("Arend Studio admins", () => {
  it("cannot see a school's data unless support access is on", async () => {
    const admin = await makeAdmin();
    const db = scopedDb(app, { userId: admin.id, schoolId: schoolA.id });
    expect(await db.membership.findMany()).toEqual([]);

    await owner.school.update({
      where: { id: schoolA.id },
      data: { supportAccessUntil: new Date(Date.now() + 60 * 60 * 1000) },
    });
    expect((await db.membership.findMany()).length).toBeGreaterThan(0);

    await owner.school.update({
      where: { id: schoolA.id },
      data: { supportAccessUntil: new Date(Date.now() - 1000) },
    });
    expect(await db.membership.findMany()).toEqual([]);
  });
});

describe("the audit log", () => {
  it("is append-only for the app", async () => {
    await withContext(app, ctxA(), (tx) =>
      tx.auditLog.create({
        data: { schoolId: schoolA.id, actorId: userA.id, action: "test.append" },
      }),
    );
    await expect(
      withContext(app, ctxA(), (tx) =>
        tx.auditLog.updateMany({ where: { schoolId: schoolA.id }, data: { action: "x" } }),
      ),
    ).rejects.toThrow();
    await expect(
      withContext(app, ctxA(), (tx) => tx.auditLog.deleteMany({ where: { schoolId: schoolA.id } })),
    ).rejects.toThrow();
  });

  it("records platform events (like sign-in) for the acting user only", async () => {
    const ctx = { userId: userA.id, schoolId: null };
    await withContext(app, ctx, (tx) =>
      tx.auditLog.create({ data: { schoolId: null, actorId: userA.id, action: "auth.sign_in" } }),
    );
    await expect(
      withContext(app, ctx, (tx) =>
        tx.auditLog.create({ data: { schoolId: null, actorId: userB.id, action: "auth.sign_in" } }),
      ),
    ).rejects.toThrow(/row-level security/i);
    // Another user cannot read them.
    const others = await scopedDb(app, { userId: userB.id, schoolId: null }).auditLog.findMany({
      where: { actorId: userA.id },
    });
    expect(others).toEqual([]);
  });

  it("cannot be changed even by the owner", async () => {
    await expect(
      owner.auditLog.updateMany({ where: { schoolId: schoolB.id }, data: { action: "x" } }),
    ).rejects.toThrow(/append-only/);
  });
});
