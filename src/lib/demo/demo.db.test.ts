import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/auth/permissions";
import { scopedDb } from "@/lib/db-core";
import { app, makeAdmin, makeMember, makeSchool, owner } from "../../../tests/db-helpers";
import {
  RateLimitedError,
  listDemoRequests,
  parseDemoRequest,
  setDemoStatus,
  submitDemoRequest,
} from "./service";

const input = (school: string) =>
  parseDemoRequest({
    schoolName: school,
    county: "Kilifi",
    contactName: "Test Person",
    contactRole: "Director",
    phone: "0712345678",
    studentCount: "300",
    schoolType: "mixed",
  });

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe("demo requests", () => {
  it("anyone can submit; only Arend admins can read and update", async () => {
    const name = `Demo School ${randomUUID()}`;
    const id = await submitDemoRequest(app, input(name), randomUUID());

    // Anonymous and school users see nothing.
    expect(await app.demoRequest.findMany({ where: { id } })).toEqual([]);
    const school = await makeSchool(`Demo ${Date.now()}`);
    const d = await makeMember(school.id, ["director"]);
    expect(
      await scopedDb(app, { userId: d.user.id, schoolId: school.id }).demoRequest.findMany({
        where: { id },
      }),
    ).toEqual([]);
    await expect(
      listDemoRequests(app, { userId: d.user.id, isPlatformAdmin: false }),
    ).rejects.toThrow(ForbiddenError);

    const admin = await makeAdmin();
    const list = await listDemoRequests(app, { userId: admin.id, isPlatformAdmin: true });
    expect(list.find((r) => r.id === id)).toMatchObject({
      schoolName: name,
      status: "new",
      phone: "+254712345678",
    });

    await setDemoStatus(app, { userId: admin.id, isPlatformAdmin: true }, id, "demo_booked");
    expect((await owner.demoRequest.findUniqueOrThrow({ where: { id } })).status).toBe(
      "demo_booked",
    );
    // Lying about being an admin does not get past the database.
    await expect(
      setDemoStatus(app, { userId: d.user.id, isPlatformAdmin: true }, id, "lost"),
    ).rejects.toThrow(/not found/);
  });

  it("limits each sender to 3 requests an hour", async () => {
    const sender = randomUUID();
    for (let i = 0; i < 3; i++) await submitDemoRequest(app, input(`Rate ${i}`), sender);
    await expect(submitDemoRequest(app, input("Rate 4"), sender)).rejects.toThrow(RateLimitedError);
    // Someone else is not affected.
    await expect(submitDemoRequest(app, input("Other"), randomUUID())).resolves.toBeTruthy();
  });

  it("cannot be inserted directly, only through the rate-limited function", async () => {
    await expect(
      app.demoRequest.create({
        data: { ...input("Direct"), ipHash: "x" },
      }),
    ).rejects.toThrow(/permission denied/i);
  });
});
