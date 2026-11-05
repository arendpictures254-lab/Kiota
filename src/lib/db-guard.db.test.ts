import { afterAll, describe, expect, it } from "vitest";
import { app, makeSchool, owner } from "../../tests/db-helpers";
import { withContext } from "./db-core";
import { SchoolWallError } from "./db-guard";

afterAll(async () => {
  await owner.$disconnect();
});

describe("the school-wall guard on the app client", () => {
  it("throws for a query without schoolId, naming the model and the line", async () => {
    let err: unknown;
    try {
      await app.student.findMany({ where: { status: "active" } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SchoolWallError);
    expect((err as Error).message).toMatch(
      /^School wall: Student\.findMany has no schoolId condition \(src\/lib\/db-guard\.db\.test\.ts:\d+:\d+\)$/,
    );
  });

  it("checks inside transactions too, and lets a scoped query through", async () => {
    const school = await makeSchool(`Guard ${Date.now()}`);
    const ctx = { userId: null, schoolId: school.id };
    await expect(withContext(app, ctx, (tx) => tx.level.findMany())).rejects.toThrow(
      /School wall: Level\.findMany/,
    );
    await expect(
      withContext(app, ctx, (tx) => tx.level.findMany({ where: { schoolId: school.id } })),
    ).resolves.toEqual([]); // no membership: row-level security still shows nothing
  });

  it("leaves platform tables alone", async () => {
    await expect(app.otpCode.count()).resolves.toBeTypeOf("number");
  });
});
