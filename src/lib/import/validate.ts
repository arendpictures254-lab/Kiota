/**
 * Validate an uploaded file against the school's current data and turn it into an import plan.
 * Pure: no database access, so every rule is unit tested. Every problem names the sheet, row and
 * column, and says in plain English how to fix it.
 */
import { normalizePhone } from "@/lib/phone";
import { clean, isoDate, parseDate } from "@/lib/service-kit";
import {
  type GenderValue,
  type LanguageValue,
  type RelationshipValue,
  dateOfBirthProblem,
  guardianDefaults,
  parseBoarding,
  parseGender,
  parseKesToCents,
  parseLanguage,
  parseRelationship,
  parseYesNo,
  sameName,
} from "@/lib/students/rules";
import { CLASSES_SHEET, GUARDIANS_SHEET, STUDENTS_SHEET, type SheetDef } from "./columns";
import type { RawRow, ReadProblem, SheetRows } from "./workbook";

export type Issue = {
  severity: "error" | "warning";
  sheet: string;
  row: number | null;
  column: string | null;
  message: string;
  fix: string;
};

export type ImportContext = {
  levels: {
    key: string;
    name: string;
    enabled: boolean;
    classes: { name: string; streams: string[] }[];
  }[];
  houses: string[];
  /** Active staff by E.164 phone -> membership id (for class teachers). */
  staffPhones: Map<string, string>;
  /** Existing students by admission-number key (see admissionKey). */
  existingStudents: Map<
    string,
    {
      admissionNumber: string;
      firstName: string;
      lastName: string;
      guardianCount: number;
      openingBalancePosted: boolean;
    }
  >;
  canMedical: boolean;
  today: Date;
};

export type PlannedStudent = {
  row: number;
  action: "create" | "update";
  admissionNumber: string;
  upi: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  gender: GenderValue;
  dateOfBirth: string;
  className: string;
  streamName: string | null;
  boarder: boolean;
  houseName: string | null;
  specialNeeds: string | null;
  medicalNotes: string | null;
  allergies: string | null;
  openingBalanceCents: number | null;
};

export type PlannedGuardian = {
  row: number;
  admissionNumber: string;
  name: string;
  phone: string;
  relationship: RelationshipValue;
  language: LanguageValue;
  receivesFees: boolean;
  receivesAcademics: boolean;
  receivesBoarding: boolean;
  authorisedToCollect: boolean;
};

export type PlannedStream = {
  row: number;
  className: string;
  streamName: string;
  teacherMembershipId: string | null;
  exists: boolean;
};

export type ImportPlan = {
  streams: PlannedStream[];
  housesToCreate: string[];
  students: PlannedStudent[];
  guardians: PlannedGuardian[];
  issues: Issue[];
  counts: {
    studentsNew: number;
    studentsUpdated: number;
    guardianRows: number;
    streamsNew: number;
    housesNew: number;
    openingBalances: number;
    errors: number;
    warnings: number;
  };
};

/** Admission numbers match regardless of case and surrounding spaces. */
export function admissionKey(v: string) {
  return v.trim().toUpperCase().replace(/\s+/g, "");
}

const nameKey = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");

export function validateImport(
  sheets: SheetRows,
  ctx: ImportContext,
  readProblems: ReadProblem[] = [],
): ImportPlan {
  const issues: Issue[] = readProblems.map((p) => ({
    severity: "error",
    sheet: p.sheet,
    row: null,
    column: null,
    message: p.message,
    fix: p.fix,
  }));

  const header = (def: SheetDef, key: string) => def.columns.find((c) => c.key === key)!.header;
  const err = (def: SheetDef, r: RawRow, key: string | null, message: string, fix: string) =>
    issues.push({
      severity: "error",
      sheet: def.name,
      row: r.row,
      column: key ? header(def, key) : null,
      message,
      fix,
    });
  const warn = (def: SheetDef, r: RawRow, key: string | null, message: string, fix: string) =>
    issues.push({
      severity: "warning",
      sheet: def.name,
      row: r.row,
      column: key ? header(def, key) : null,
      message,
      fix,
    });
  const str = (r: RawRow, key: string) => clean(r.values[key]);

  // Known classes (enabled levels only) and their streams, by lower-case name.
  const classes = new Map<
    string,
    { name: string; levelName: string; streams: Map<string, string> }
  >();
  const disabledClasses = new Map<string, string>();
  for (const level of ctx.levels) {
    for (const c of level.classes) {
      if (level.enabled) {
        classes.set(nameKey(c.name), {
          name: c.name,
          levelName: level.name,
          streams: new Map(c.streams.map((s) => [nameKey(s), s])),
        });
      } else {
        disabledClasses.set(nameKey(c.name), level.name);
      }
    }
  }
  const unknownClassFix = (name: string) =>
    disabledClasses.has(nameKey(name))
      ? `${name} belongs to ${disabledClasses.get(nameKey(name))}, which is switched off. Switch it on in School setup → Levels.`
      : `Use a class from the list, for example ${
          [...classes.values()]
            .slice(0, 2)
            .map((c) => c.name)
            .join(" or ") || "Grade 7"
        }.`;

  // ---- Classes sheet: new streams ----------------------------------------
  const streams: PlannedStream[] = [];
  const seenStreams = new Map<string, number>();
  for (const r of sheets.Classes) {
    const def = CLASSES_SHEET;
    const levelName = str(r, "level");
    const className = str(r, "class");
    const streamName = str(r, "stream");
    if (!className) {
      err(def, r, "class", "The class is missing.", "Choose the class, for example Grade 7.");
      continue;
    }
    const cls = classes.get(nameKey(className));
    if (!cls) {
      err(
        def,
        r,
        "class",
        `Kiota does not know the class "${className}".`,
        unknownClassFix(className),
      );
      continue;
    }
    if (levelName) {
      const level = ctx.levels.find(
        (l) => nameKey(l.name) === nameKey(levelName) || l.key === levelName.toLowerCase(),
      );
      if (!level || nameKey(level.name) !== nameKey(cls.levelName)) {
        err(
          def,
          r,
          "level",
          `${cls.name} is not in "${levelName}".`,
          `Choose ${cls.levelName}, or leave Level blank.`,
        );
        continue;
      }
    }
    if (!streamName) {
      err(def, r, "stream", "The stream name is missing.", "Enter the stream, for example East.");
      continue;
    }
    const key = `${nameKey(cls.name)}|${nameKey(streamName)}`;
    if (seenStreams.has(key)) {
      warn(
        def,
        r,
        "stream",
        `${cls.name} ${streamName} is listed twice.`,
        `Row ${seenStreams.get(key)} already adds it; this row is ignored.`,
      );
      continue;
    }
    seenStreams.set(key, r.row);

    let teacherMembershipId: string | null = null;
    const teacherRaw = str(r, "teacherPhone");
    if (teacherRaw) {
      const phone = normalizePhone(teacherRaw);
      if (!phone) {
        err(
          def,
          r,
          "teacherPhone",
          `"${teacherRaw}" is not a valid phone number.`,
          "Use a mobile number like 0712 345 678, or leave it blank.",
        );
        continue;
      }
      teacherMembershipId = ctx.staffPhones.get(phone) ?? null;
      if (!teacherMembershipId) {
        err(
          def,
          r,
          "teacherPhone",
          `${teacherRaw} is not on your staff list.`,
          "Invite the teacher in Staff first, or leave it blank.",
        );
        continue;
      }
    }
    const existingName = cls.streams.get(nameKey(streamName));
    streams.push({
      row: r.row,
      className: cls.name,
      streamName: existingName ?? streamName,
      teacherMembershipId,
      exists: !!existingName,
    });
  }
  const streamsInFile = new Map<string, Set<string>>();
  for (const s of streams) {
    const set = streamsInFile.get(nameKey(s.className)) ?? new Set();
    set.add(nameKey(s.streamName));
    streamsInFile.set(nameKey(s.className), set);
  }

  // ---- Students sheet ----------------------------------------------------
  const students: PlannedStudent[] = [];
  const seenAdmission = new Map<string, number>();
  const seenUpi = new Map<string, number>();
  const housesKnown = new Map(ctx.houses.map((h) => [nameKey(h), h]));
  const housesToCreate = new Map<string, string>();

  for (const r of sheets.Students) {
    const def = STUDENTS_SHEET;
    const before = issues.filter((i) => i.severity === "error").length;
    const admissionNumber = str(r, "admissionNumber");
    if (!admissionNumber) {
      err(
        def,
        r,
        "admissionNumber",
        "The admission number is missing.",
        "Every student needs the school's admission number.",
      );
      continue;
    }
    const aKey = admissionKey(admissionNumber);
    if (seenAdmission.has(aKey)) {
      err(
        def,
        r,
        "admissionNumber",
        `Admission number ${admissionNumber} is used twice in this file (also row ${seenAdmission.get(aKey)}).`,
        "Give each student their own admission number, or delete the repeated row.",
      );
      continue;
    }
    seenAdmission.set(aKey, r.row);

    const firstName = str(r, "firstName");
    const lastName = str(r, "lastName");
    if (!firstName)
      err(def, r, "firstName", "The first name is missing.", "Enter the student's first name.");
    if (!lastName)
      err(def, r, "lastName", "The last name is missing.", "Enter the student's last name.");

    const existing = ctx.existingStudents.get(aKey);
    if (existing && firstName && lastName && !sameName(existing, { firstName, lastName })) {
      err(
        def,
        r,
        "admissionNumber",
        `Admission number ${admissionNumber} already belongs to ${existing.firstName} ${existing.lastName} in Kiota.`,
        "Check the number. If it is the same child, use the name Kiota has; change names on the student's profile.",
      );
    }

    const gender = parseGender(r.values.gender);
    if (!gender)
      err(
        def,
        r,
        "gender",
        str(r, "gender")
          ? `"${str(r, "gender")}" is not a gender Kiota understands.`
          : "The gender is missing.",
        "Choose Female or Male.",
      );

    const dobRaw = r.values.dateOfBirth;
    const dob = parseDate(dobRaw);
    if (!dob) {
      err(
        def,
        r,
        "dateOfBirth",
        clean(dobRaw) ? `"${clean(dobRaw)}" is not a date.` : "The date of birth is missing.",
        "Write it as day/month/year, for example 14/03/2014.",
      );
    } else {
      const problem = dateOfBirthProblem(dob, ctx.today);
      if (problem)
        err(
          def,
          r,
          "dateOfBirth",
          `${problem} (${isoDate(dob)})`,
          "Check the year. Write it as day/month/year, for example 14/03/2014.",
        );
    }

    const className = str(r, "class");
    const streamRaw = str(r, "stream");
    let resolvedClass: string | null = null;
    let resolvedStream: string | null = null;
    if (!className) {
      err(def, r, "class", "The class is missing.", "Choose the class, for example Grade 7.");
    } else {
      const cls = classes.get(nameKey(className));
      if (!cls) {
        err(
          def,
          r,
          "class",
          `Kiota does not know the class "${className}".`,
          unknownClassFix(className),
        );
      } else {
        resolvedClass = cls.name;
        const fileStreams = streamsInFile.get(nameKey(cls.name)) ?? new Set();
        const hasStreams = cls.streams.size > 0 || fileStreams.size > 0;
        if (streamRaw) {
          const dbName = cls.streams.get(nameKey(streamRaw));
          const inFile = fileStreams.has(nameKey(streamRaw));
          if (!dbName && !inFile) {
            const known = [...cls.streams.values()];
            err(
              def,
              r,
              "stream",
              `${cls.name} has no stream called "${streamRaw}".`,
              known.length
                ? `Use one of: ${known.join(", ")}. Or add the stream on the Classes sheet.`
                : "Add the stream on the Classes sheet, or leave Stream blank.",
            );
          } else {
            resolvedStream =
              dbName ??
              streams.find(
                (s) =>
                  nameKey(s.className) === nameKey(cls.name) &&
                  nameKey(s.streamName) === nameKey(streamRaw),
              )!.streamName;
          }
        } else if (hasStreams) {
          err(
            def,
            r,
            "stream",
            `${cls.name} has streams, so the stream is needed.`,
            `Choose one of: ${[...cls.streams.values(), ...fileStreams].join(", ")}.`,
          );
        }
      }
    }

    const boarder = parseBoarding(r.values.boarding);
    if (boarder === null)
      err(
        def,
        r,
        "boarding",
        str(r, "boarding")
          ? `"${str(r, "boarding")}" is not Boarder or Day.`
          : "Boarder or day is missing.",
        "Choose Boarder or Day.",
      );

    const upi = str(r, "upi");
    if (upi) {
      if (!/^[A-Za-z0-9-]{3,20}$/.test(upi)) {
        err(
          def,
          r,
          "upi",
          `"${upi}" does not look like a UPI.`,
          "Use the NEMIS UPI (letters and numbers), or leave it blank.",
        );
      } else if (seenUpi.has(upi.toUpperCase())) {
        err(
          def,
          r,
          "upi",
          `UPI ${upi} is used twice in this file (also row ${seenUpi.get(upi.toUpperCase())}).`,
          "Each child has their own UPI. Check both rows.",
        );
      } else seenUpi.set(upi.toUpperCase(), r.row);
    }

    const houseRaw = str(r, "house");
    let houseName: string | null = null;
    if (houseRaw) {
      houseName =
        housesKnown.get(nameKey(houseRaw)) ?? housesToCreate.get(nameKey(houseRaw)) ?? houseRaw;
      if (!housesKnown.has(nameKey(houseRaw)) && !housesToCreate.has(nameKey(houseRaw))) {
        housesToCreate.set(nameKey(houseRaw), houseRaw);
        warn(
          def,
          r,
          "house",
          `House "${houseRaw}" is new and will be created.`,
          "If this is a spelling mistake, correct it to an existing house.",
        );
      }
    }

    const medicalNotes = str(r, "medicalNotes");
    const allergies = str(r, "allergies");
    if ((medicalNotes || allergies) && !ctx.canMedical) {
      err(
        def,
        r,
        medicalNotes ? "medicalNotes" : "allergies",
        "You are not allowed to record medical information.",
        "Ask the Director to import this file, or clear the medical columns.",
      );
    }

    let openingBalanceCents: number | null = null;
    const ob = parseKesToCents(r.values.openingBalance);
    if ("error" in ob) {
      err(
        def,
        r,
        "openingBalance",
        `"${clean(r.values.openingBalance)}" is not an amount.`,
        "Write the amount in shillings, for example 12500 or 12,500.50. Use a minus sign for a credit.",
      );
    } else if (ob.cents !== null) {
      if (existing?.openingBalancePosted) {
        warn(
          def,
          r,
          "openingBalance",
          "This student's opening balance is already in the fees ledger, so it will not change.",
          "Correct balances in the fees module instead.",
        );
      } else {
        openingBalanceCents = ob.cents;
        if (Math.abs(ob.cents) > 100_000_000) {
          warn(
            def,
            r,
            "openingBalance",
            `An opening balance of KES ${(ob.cents / 100).toLocaleString("en-KE")} is unusually large.`,
            "Check the amount (shillings, not cents).",
          );
        }
      }
    }

    const hadError = issues.filter((i) => i.severity === "error").length > before;
    if (hadError) continue;
    students.push({
      row: r.row,
      action: existing ? "update" : "create",
      admissionNumber: existing?.admissionNumber ?? admissionNumber,
      upi,
      firstName: firstName!,
      middleName: str(r, "middleName"),
      lastName: lastName!,
      gender: gender!,
      dateOfBirth: isoDate(dob)!,
      className: resolvedClass!,
      streamName: resolvedStream,
      boarder: boarder!,
      houseName,
      specialNeeds: str(r, "specialNeeds"),
      medicalNotes,
      allergies,
      openingBalanceCents,
    });
  }

  // ---- Guardians sheet ---------------------------------------------------
  const guardians: PlannedGuardian[] = [];
  const seenPair = new Map<string, number>();
  const guardianCount = new Map<string, number>();
  for (const r of sheets.Guardians) {
    const def = GUARDIANS_SHEET;
    const before = issues.filter((i) => i.severity === "error").length;
    const admissionNumber = str(r, "admissionNumber");
    let studentAdmission: string | null = null;
    if (!admissionNumber) {
      err(
        def,
        r,
        "admissionNumber",
        "The student's admission number is missing.",
        "Enter the admission number of the student this guardian belongs to.",
      );
    } else {
      const aKey = admissionKey(admissionNumber);
      const inFile = seenAdmission.has(aKey);
      const existing = ctx.existingStudents.get(aKey);
      if (!inFile && !existing) {
        err(
          def,
          r,
          "admissionNumber",
          `No student has admission number ${admissionNumber}.`,
          "Add the student on the Students sheet, or correct the number.",
        );
      } else {
        studentAdmission = existing?.admissionNumber ?? admissionNumber;
      }
    }
    const name = str(r, "name");
    if (!name)
      err(def, r, "name", "The guardian's name is missing.", "Enter the guardian's full name.");

    const phoneRaw = str(r, "phone");
    const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
    if (!phoneRaw)
      err(
        def,
        r,
        "phone",
        "The phone number is missing.",
        "Every guardian needs a mobile number; Kiota sends fee and school messages to it.",
      );
    else if (!phone)
      err(
        def,
        r,
        "phone",
        `"${phoneRaw}" is not a valid phone number.`,
        "Use a Kenyan mobile number like 0712 345 678 (10 digits starting 07 or 01).",
      );

    const relationship = parseRelationship(r.values.relationship);
    if (!relationship)
      err(
        def,
        r,
        "relationship",
        str(r, "relationship")
          ? `"${str(r, "relationship")}" is not a relationship Kiota understands.`
          : "The relationship is missing.",
        "Choose Mother, Father, Guardian, Sponsor or Other.",
      );

    const language = parseLanguage(r.values.language);
    if (!language)
      err(
        def,
        r,
        "language",
        `"${str(r, "language")}" is not a language Kiota sends messages in.`,
        "Choose English or Kiswahili, or leave it blank for English.",
      );

    const defaults = guardianDefaults(relationship ?? "guardian");
    const flags = {} as Record<
      "receivesFees" | "receivesAcademics" | "receivesBoarding" | "authorisedToCollect",
      boolean
    >;
    for (const k of [
      "receivesFees",
      "receivesAcademics",
      "receivesBoarding",
      "authorisedToCollect",
    ] as const) {
      const v = parseYesNo(r.values[k], defaults[k]);
      if (v === null)
        err(
          def,
          r,
          k,
          `"${str(r, k)}" is not Yes or No.`,
          "Write Yes or No, or leave it blank for the default.",
        );
      flags[k] = v ?? defaults[k];
    }

    if (studentAdmission && phone) {
      const pair = `${admissionKey(studentAdmission)}|${phone}`;
      if (seenPair.has(pair)) {
        err(
          def,
          r,
          "phone",
          `This guardian is listed twice for ${studentAdmission} (also row ${seenPair.get(pair)}).`,
          "Delete the repeated row.",
        );
      } else seenPair.set(pair, r.row);
    }

    if (issues.filter((i) => i.severity === "error").length > before) continue;
    guardianCount.set(
      admissionKey(studentAdmission!),
      (guardianCount.get(admissionKey(studentAdmission!)) ?? 0) + 1,
    );
    guardians.push({
      row: r.row,
      admissionNumber: studentAdmission!,
      name: name!,
      phone: phone!,
      relationship: relationship!,
      language: language!,
      ...flags,
    });
  }

  // Students with no guardian anywhere: a warning, not an error.
  for (const s of students) {
    const key = admissionKey(s.admissionNumber);
    const existingCount = ctx.existingStudents.get(key)?.guardianCount ?? 0;
    if ((guardianCount.get(key) ?? 0) + existingCount === 0) {
      issues.push({
        severity: "warning",
        sheet: STUDENTS_SHEET.name,
        row: s.row,
        column: null,
        message: `${s.firstName} ${s.lastName} (${s.admissionNumber}) has no guardian.`,
        fix: "Add at least one guardian on the Guardians sheet so the school can reach the family. You can also add one later.",
      });
    }
  }

  issues.sort((a, b) =>
    a.severity !== b.severity
      ? a.severity === "error"
        ? -1
        : 1
      : a.sheet.localeCompare(b.sheet) || (a.row ?? 0) - (b.row ?? 0),
  );

  return {
    streams,
    housesToCreate: [...housesToCreate.values()],
    students,
    guardians,
    issues,
    counts: {
      studentsNew: students.filter((s) => s.action === "create").length,
      studentsUpdated: students.filter((s) => s.action === "update").length,
      guardianRows: guardians.length,
      streamsNew: streams.filter((s) => !s.exists).length,
      housesNew: housesToCreate.size,
      openingBalances: students.filter((s) => s.openingBalanceCents !== null).length,
      errors: issues.filter((i) => i.severity === "error").length,
      warnings: issues.filter((i) => i.severity === "warning").length,
    },
  };
}
