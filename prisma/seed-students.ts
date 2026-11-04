/**
 * Development seed for structure, students and guardians (runs as the owner, idempotent).
 * Bahari Academy: Grade 7 and 8, East and West (60 students). Milima School: one Grade 10
 * student whose mother also has a child at Bahari, so her Milima link waits for her to confirm.
 */
import type { PrismaClient } from "../src/generated/prisma/client";

export const SHARED_PARENT = { phone: "+254744000001", name: "Wanjiku Kamau" };

const FIRST_GIRLS = [
  "Achieng",
  "Wanjiru",
  "Amina",
  "Zawadi",
  "Neema",
  "Faith",
  "Mercy",
  "Halima",
  "Akinyi",
  "Njeri",
  "Chebet",
  "Imani",
  "Shiku",
  "Nafula",
  "Wairimu",
];
const FIRST_BOYS = [
  "Baraka",
  "Brian",
  "Kevin",
  "Otieno",
  "Juma",
  "Kamau",
  "Kipchoge",
  "Omondi",
  "Mwangi",
  "Hassan",
  "Ian",
  "Tumaini",
  "Wekesa",
  "Kibet",
  "Musa",
];
const LAST = [
  "Otieno",
  "Mwangi",
  "Kamau",
  "Wanjala",
  "Odhiambo",
  "Kiprop",
  "Mutua",
  "Said",
  "Njoroge",
  "Chege",
  "Ochieng",
  "Kariuki",
  "Barasa",
  "Mohamed",
  "Onyango",
];
const MOTHERS = [
  "Mary",
  "Grace",
  "Ruth",
  "Esther",
  "Lucy",
  "Jane",
  "Rose",
  "Fatuma",
  "Agnes",
  "Joyce",
];
const FATHERS = [
  "John",
  "Peter",
  "James",
  "Joseph",
  "Daniel",
  "Samuel",
  "Ali",
  "David",
  "Paul",
  "Stephen",
];

export async function seedStudents(owner: PrismaClient, schoolIds: Map<string, string>) {
  const bahari = schoolIds.get("Bahari Academy")!;
  const milima = schoolIds.get("Milima School")!;

  async function stream(schoolId: string, className: string, name: string, teacherPhone?: string) {
    const cls = await owner.class.findUniqueOrThrow({
      where: { schoolId_name: { schoolId, name: className } },
    });
    let classTeacherMembershipId: string | null = null;
    if (teacherPhone) {
      const user = await owner.user.findUniqueOrThrow({ where: { phone: teacherPhone } });
      classTeacherMembershipId = (
        await owner.membership.findUniqueOrThrow({
          where: { schoolId_userId: { schoolId, userId: user.id } },
        })
      ).id;
    }
    return owner.stream.upsert({
      where: { classId_name: { classId: cls.id, name } },
      create: { schoolId, classId: cls.id, name, classTeacherMembershipId },
      update: { classTeacherMembershipId },
    });
  }

  async function house(schoolId: string, name: string) {
    return owner.house.upsert({
      where: { schoolId_name: { schoolId, name } },
      create: { schoolId, name },
      update: {},
    });
  }

  async function student(
    schoolId: string,
    s: {
      admissionNumber: string;
      firstName: string;
      lastName: string;
      gender: "male" | "female";
      dateOfBirth: string;
      streamId: string;
      classId: string;
      boarder: boolean;
      houseId: string | null;
    },
  ) {
    const existing = await owner.student.findUnique({
      where: { schoolId_admissionNumber: { schoolId, admissionNumber: s.admissionNumber } },
    });
    if (existing) return existing;
    const created = await owner.student.create({
      data: {
        ...s,
        schoolId,
        dateOfBirth: new Date(`${s.dateOfBirth}T00:00:00Z`),
        statusDate: new Date("2026-12-01"),
      },
    });
    await owner.studentStatusChange.create({
      data: {
        schoolId,
        studentId: created.id,
        toStatus: "active",
        date: new Date("2026-12-01"),
        reason: "Development seed",
        changedBy: created.id,
      },
    });
    return created;
  }

  async function guardian(
    schoolId: string,
    studentId: string,
    g: { phone: string; name: string; relationship: "mother" | "father" },
  ) {
    const user = await owner.user.upsert({
      where: { phone: g.phone },
      create: { phone: g.phone, name: g.name },
      update: {},
    });
    return owner.guardianLink.upsert({
      where: { studentId_userId: { studentId, userId: user.id } },
      create: {
        schoolId,
        studentId,
        userId: user.id,
        name: g.name,
        relationship: g.relationship,
        authorisedToCollect: true,
      },
      update: {},
    });
  }

  // ---- Structure ----
  const streams = [
    await stream(bahari, "Grade 7", "East", "+254711000003"), // Grace Wanjiru is class teacher
    await stream(bahari, "Grade 7", "West"),
    await stream(bahari, "Grade 8", "East"),
    await stream(bahari, "Grade 8", "West"),
  ];
  const houses = [
    await house(bahari, "Simba"),
    await house(bahari, "Chui"),
    await house(bahari, "Ndovu"),
  ];
  for (const [name, beds] of [
    ["Mnazi", 40],
    ["Mkoko", 40],
    ["Mvule", 32],
  ] as const) {
    await owner.dormitory.upsert({
      where: { schoolId_name: { schoolId: bahari, name } },
      create: { schoolId: bahari, name, bedCapacity: beds },
      update: {},
    });
  }
  for (const schoolId of [bahari, milima]) {
    const year = await owner.academicYear.upsert({
      where: { schoolId_name: { schoolId, name: "2027" } },
      create: {
        schoolId,
        name: "2027",
        startDate: new Date("2027-01-01"),
        endDate: new Date("2027-12-31"),
      },
      update: {},
    });
    for (const t of [
      {
        name: "Term 1",
        startDate: "2027-01-06",
        halfTermStart: "2027-02-25",
        halfTermEnd: "2027-03-01",
        endDate: "2027-04-03",
      },
      {
        name: "Term 2",
        startDate: "2027-04-28",
        halfTermStart: "2027-06-24",
        halfTermEnd: "2027-06-28",
        endDate: "2027-08-01",
      },
      {
        name: "Term 3",
        startDate: "2027-08-26",
        halfTermStart: null,
        halfTermEnd: null,
        endDate: "2027-10-30",
      },
    ]) {
      const d = (v: string | null) => (v ? new Date(`${v}T00:00:00Z`) : null);
      await owner.term.upsert({
        where: { academicYearId_name: { academicYearId: year.id, name: t.name } },
        create: {
          schoolId,
          academicYearId: year.id,
          name: t.name,
          startDate: d(t.startDate)!,
          halfTermStart: d(t.halfTermStart),
          halfTermEnd: d(t.halfTermEnd),
          endDate: d(t.endDate)!,
        },
        update: {},
      });
    }
  }

  // ---- 60 Bahari students, 15 per stream ----
  let n = 0;
  for (const st of streams) {
    const isGrade7 =
      st.name &&
      (await owner.class.findUniqueOrThrow({ where: { id: st.classId } })).name === "Grade 7";
    for (let i = 0; i < 15; i++, n++) {
      const girl = n % 2 === 0;
      const firstName = (girl ? FIRST_GIRLS : FIRST_BOYS)[(n * 7) % 15];
      const lastName = LAST[(n * 11) % 15];
      const year = isGrade7 ? 2014 : 2013;
      const s = await student(bahari, {
        admissionNumber: `BA/${isGrade7 ? 2025 : 2024}/${String(n + 1).padStart(3, "0")}`,
        firstName,
        lastName,
        gender: girl ? "female" : "male",
        dateOfBirth: `${year}-${String((n % 12) + 1).padStart(2, "0")}-${String((n % 27) + 1).padStart(2, "0")}`,
        streamId: st.id,
        classId: st.classId,
        boarder: n % 3 !== 0,
        houseId: houses[n % 3].id,
      });
      await guardian(bahari, s.id, {
        phone: `+2547450${String(n + 1).padStart(5, "0")}`,
        name: `${MOTHERS[n % 10]} ${lastName}`,
        relationship: "mother",
      });
      if (n % 2 === 0) {
        await guardian(bahari, s.id, {
          phone: `+2547460${String(n + 1).padStart(5, "0")}`,
          name: `${FATHERS[n % 10]} ${lastName}`,
          relationship: "father",
        });
      }
      if (n % 10 === 0) {
        await owner.studentMedical.upsert({
          where: { studentId: s.id },
          create: {
            schoolId: bahari,
            studentId: s.id,
            medicalNotes: "Asthma: inhaler in the sick bay",
            allergies: "Peanuts",
          },
          update: {},
        });
      }
      if (n % 4 === 0) {
        await owner.openingBalance.upsert({
          where: { studentId: s.id },
          create: {
            schoolId: bahari,
            studentId: s.id,
            amountCents: 1_250_000 + n * 10_000,
            source: "Development seed",
          },
          update: {},
        });
      }
    }
  }

  // ---- The parent with children at both schools ----
  const brian = await student(bahari, {
    admissionNumber: "BA/2024/101",
    firstName: "Brian",
    lastName: "Kamau",
    gender: "male",
    dateOfBirth: "2013-04-12",
    streamId: streams[2].id,
    classId: streams[2].classId,
    boarder: true,
    houseId: houses[0].id,
  });
  await guardian(bahari, brian.id, { ...SHARED_PARENT, relationship: "mother" });

  const g10 = await stream(milima, "Grade 10", "North", "+254722000003");
  const joy = await student(milima, {
    admissionNumber: "MS/2026/001",
    firstName: "Joy",
    lastName: "Kamau",
    gender: "female",
    dateOfBirth: "2011-09-30",
    streamId: g10.id,
    classId: g10.classId,
    boarder: true,
    houseId: null,
  });
  const milimaLink = await guardian(milima, joy.id, { ...SHARED_PARENT, relationship: "mother" });
  const parent = await owner.user.findUniqueOrThrow({ where: { phone: SHARED_PARENT.phone } });
  await owner.parentLinkConfirmation.upsert({
    where: { guardianLinkId: milimaLink.id },
    create: { guardianLinkId: milimaLink.id, userId: parent.id, status: "pending" },
    update: {},
  });
}
