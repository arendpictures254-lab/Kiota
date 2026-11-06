import { describe, expect, it } from "vitest";
import { matchPhotoFiles, photoFileKey } from "@/lib/students/photo-match";
import {
  atMinute,
  attendancePercent,
  correctionAllowed,
  dayStatus,
  isoDay,
  nairobiDate,
  nairobiMinute,
  nextStatus,
} from "./rules";

describe("the register's tap", () => {
  it("cycles Present → Absent → Late → Present", () => {
    expect(nextStatus("present")).toBe("absent");
    expect(nextStatus("absent")).toBe("late");
    expect(nextStatus("late")).toBe("present");
  });
});

describe("school days in Nairobi time", () => {
  it("uses the Nairobi date and minute, not UTC", () => {
    const lateEvening = new Date("2026-11-11T22:30:00Z"); // 01:30 on the 12th in Nairobi
    expect(isoDay(nairobiDate(lateEvening))).toBe("2026-11-12");
    expect(nairobiMinute(lateEvening)).toBe(90);
    expect(atMinute(nairobiDate(lateEvening), 450).toISOString()).toBe("2026-11-12T04:30:00.000Z");
  });
});

describe("corrections", () => {
  const day = new Date("2026-11-11T00:00:00Z");
  const next = new Date("2026-11-12T00:00:00Z");
  it("the teacher on the same day; only the Principal later", () => {
    expect(
      correctionAllowed({ registerDay: day, today: day, canTake: true, canManage: false }),
    ).toEqual({ ok: true });
    expect(
      correctionAllowed({ registerDay: day, today: next, canTake: true, canManage: false }),
    ).toMatchObject({ ok: false });
    expect(
      correctionAllowed({ registerDay: day, today: next, canTake: false, canManage: true }),
    ).toEqual({ ok: true });
  });
});

describe("a day and a term", () => {
  it("rolls registers up into one day", () => {
    expect(dayStatus(["present", "present"])).toBe("present");
    expect(dayStatus(["present", "late"])).toBe("late");
    expect(dayStatus(["absent", "absent"])).toBe("absent");
    expect(dayStatus(["absent", "present"])).toBe("part");
    expect(dayStatus(["on_leave", "on_leave"])).toBe("on_leave");
    expect(dayStatus([])).toBeNull();
  });
  it("counts present and late, leaves out On leave", () => {
    expect(attendancePercent(["present", "late", "absent", "on_leave"])).toBe(66.7);
    expect(attendancePercent(["on_leave"])).toBeNull();
  });
});

describe("bulk photo matching", () => {
  const students = [
    { id: "1", admissionNumber: "BA/2025/002", name: "Amani", hasPhoto: false },
    { id: "2", admissionNumber: "BA/2025/003", name: "Baraka", hasPhoto: true },
    { id: "3", admissionNumber: "BA/2025/004", name: "Chiku", hasPhoto: false },
  ];
  it("matches files named by admission number, whatever the separators", () => {
    expect(photoFileKey("photos/BA-2025-002.jpg")).toBe("BA2025002");
    expect(photoFileKey("ba_2025_002.JPEG")).toBe("BA2025002");
    expect(photoFileKey("notes.txt")).toBeNull();
    expect(photoFileKey("__MACOSX/._BA-2025-002.jpg")).toBeNull();
    const r = matchPhotoFiles(
      [
        "BA-2025-002.jpg",
        "BA_2025_003.png",
        "ba2025002.webp",
        "XY-1.jpg",
        "list.xlsx",
        ".DS_Store",
      ],
      students,
    );
    expect(r.matched.map((m) => [m.file, m.studentId, m.replaces])).toEqual([
      ["BA-2025-002.jpg", "1", false],
      ["BA_2025_003.png", "2", true],
    ]);
    expect(r.duplicates).toEqual(["ba2025002.webp"]);
    expect(r.unmatched).toEqual(["XY-1.jpg"]);
    expect(r.notPhotos).toEqual(["list.xlsx"]);
    expect(r.withoutPhoto.map((s) => s.name)).toEqual(["Chiku"]);
  });
});
