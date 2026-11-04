/**
 * The import file layout: one definition used to build the template, read uploads and write the
 * README sheet. Headers are matched case-insensitively and ignoring "*", so column order and
 * small header edits do not matter.
 */

export type Column = {
  key: string;
  header: string;
  required?: boolean;
  /** Plain-English explanation for the README sheet. */
  help: string;
  example: string;
  width?: number;
  /** Name of a list (Lists sheet) or literal options for an in-cell dropdown. */
  dropdown?: { list: string } | { options: string[] };
  date?: boolean;
  text?: boolean;
};

export type SheetDef = {
  name: "Classes" | "Students" | "Guardians";
  intro: string;
  columns: Column[];
};

export const YES_NO = ["Yes", "No"];

export const CLASSES_SHEET: SheetDef = {
  name: "Classes",
  intro:
    "One row per stream. Use it to create streams (for example Grade 7 East) and name their " +
    "class teacher. Classes themselves come from School setup; you only add streams here.",
  columns: [
    {
      key: "level",
      header: "Level",
      required: true,
      help: "A level your school has switched on.",
      example: "Junior School",
      width: 18,
      dropdown: { list: "Levels" },
    },
    {
      key: "class",
      header: "Class",
      required: true,
      help: "The grade or form within that level.",
      example: "Grade 7",
      width: 14,
      dropdown: { list: "Classes" },
    },
    {
      key: "stream",
      header: "Stream",
      required: true,
      help: "The stream name.",
      example: "East",
      width: 14,
    },
    {
      key: "teacherPhone",
      header: "Class teacher phone",
      help: "Optional. Phone number of a staff member already added in Kiota.",
      example: "0711 000 003",
      width: 20,
      text: true,
    },
  ],
};

export const STUDENTS_SHEET: SheetDef = {
  name: "Students",
  intro: "One row per student. Re-importing the same admission number updates that student.",
  columns: [
    {
      key: "admissionNumber",
      header: "Admission number",
      required: true,
      help: "Unique in your school. Keep the school's existing numbers.",
      example: "BA/2027/001",
      width: 18,
      text: true,
    },
    {
      key: "upi",
      header: "UPI (NEMIS)",
      help: "Optional NEMIS Unique Personal Identifier.",
      example: "A1B2C3",
      width: 14,
      text: true,
    },
    {
      key: "firstName",
      header: "First name",
      required: true,
      help: "",
      example: "Achieng",
      width: 14,
    },
    { key: "middleName", header: "Middle name", help: "Optional.", example: "Neema", width: 14 },
    {
      key: "lastName",
      header: "Last name",
      required: true,
      help: "",
      example: "Otieno",
      width: 14,
    },
    {
      key: "gender",
      header: "Gender",
      required: true,
      help: "Female or Male.",
      example: "Female",
      width: 10,
      dropdown: { options: ["Female", "Male"] },
    },
    {
      key: "dateOfBirth",
      header: "Date of birth",
      required: true,
      help: "Day/month/year, for example 14/03/2014. The child must be 2 to 25 years old.",
      example: "14/03/2014",
      width: 14,
      date: true,
    },
    {
      key: "class",
      header: "Class",
      required: true,
      help: "The grade or form, for example Grade 7.",
      example: "Grade 7",
      width: 12,
      dropdown: { list: "Classes" },
    },
    {
      key: "stream",
      header: "Stream",
      help: "Required when the class has streams (from School setup or the Classes sheet).",
      example: "East",
      width: 10,
    },
    {
      key: "boarding",
      header: "Boarder or day",
      required: true,
      help: "Boarder or Day.",
      example: "Boarder",
      width: 14,
      dropdown: { options: ["Boarder", "Day"] },
    },
    {
      key: "house",
      header: "House",
      help: "Optional. A new house name is created for you.",
      example: "Simba",
      width: 12,
    },
    {
      key: "specialNeeds",
      header: "Special needs",
      help: "Optional notes the teachers should know.",
      example: "",
      width: 20,
    },
    {
      key: "medicalNotes",
      header: "Medical notes",
      help: "Optional. Only staff allowed to see medical records can read this.",
      example: "Asthma, uses inhaler",
      width: 20,
    },
    {
      key: "allergies",
      header: "Allergies",
      help: "Optional. Also restricted.",
      example: "Peanuts",
      width: 14,
    },
    {
      key: "openingBalance",
      header: "Opening fee balance (KES)",
      help: "Optional. What the student owes when Kiota starts. Use a minus sign for a credit (overpayment). Saved for the fees module; no receipt or payment is created.",
      example: "12,500",
      width: 22,
    },
  ],
};

export const GUARDIANS_SHEET: SheetDef = {
  name: "Guardians",
  intro:
    "One row per guardian per student. A parent with two children gets two rows with the same " +
    "phone number. Every student should have at least one guardian.",
  columns: [
    {
      key: "admissionNumber",
      header: "Admission number",
      required: true,
      help: "The student's admission number (from the Students sheet or already in Kiota).",
      example: "BA/2027/001",
      width: 18,
      text: true,
    },
    {
      key: "name",
      header: "Guardian name",
      required: true,
      help: "",
      example: "Mary Otieno",
      width: 20,
    },
    {
      key: "phone",
      header: "Phone",
      required: true,
      help: "Mobile number. 0712 345 678, 712345678, 254712345678 and +254712345678 all work.",
      example: "0712 345 678",
      width: 16,
      text: true,
    },
    {
      key: "relationship",
      header: "Relationship",
      required: true,
      help: "Mother, Father, Guardian, Sponsor or Other.",
      example: "Mother",
      width: 14,
      dropdown: { options: ["Mother", "Father", "Guardian", "Sponsor", "Other"] },
    },
    {
      key: "language",
      header: "Language",
      help: "English or Kiswahili for messages. Blank = English.",
      example: "Kiswahili",
      width: 12,
      dropdown: { options: ["English", "Kiswahili"] },
    },
    {
      key: "receivesFees",
      header: "Receives fees",
      help: "Yes or No. Blank = Yes.",
      example: "Yes",
      width: 12,
      dropdown: { options: YES_NO },
    },
    {
      key: "receivesAcademics",
      header: "Receives academics",
      help: "Yes or No. Blank = Yes, except sponsors (No).",
      example: "Yes",
      width: 16,
      dropdown: { options: YES_NO },
    },
    {
      key: "receivesBoarding",
      header: "Receives boarding alerts",
      help: "Yes or No. Blank = Yes, except sponsors (No).",
      example: "Yes",
      width: 20,
      dropdown: { options: YES_NO },
    },
    {
      key: "authorisedToCollect",
      header: "Authorised to collect",
      help: "Yes or No: may collect the child at leave-out. Blank = Yes for mother and father, No for others.",
      example: "Yes",
      width: 18,
      dropdown: { options: YES_NO },
    },
  ],
};

export const SHEETS = [CLASSES_SHEET, STUDENTS_SHEET, GUARDIANS_SHEET];

export function normaliseHeader(h: string) {
  return h.replace(/\*/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}
