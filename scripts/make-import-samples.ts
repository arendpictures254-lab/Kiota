/**
 * Writes the sample import files in docs/samples/ (npm run samples):
 *  - kiota-import-sample.xlsx              ready to import into the seeded Bahari Academy
 *  - kiota-import-sample-with-errors.xlsx  the same file with typical mistakes, to see the preview
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildWorkbook, type CellValue } from "../src/lib/import/workbook";

// Bahari Academy (development seed) offers Primary and Junior School.
const lists = {
  levels: ["Primary", "Junior School"],
  classes: [
    "Grade 1",
    "Grade 2",
    "Grade 3",
    "Grade 4",
    "Grade 5",
    "Grade 6",
    "Grade 7",
    "Grade 8",
    "Grade 9",
  ],
};

type Row = Record<string, CellValue>;

const classes: Row[] = [
  { level: "Primary", class: "Grade 6", stream: "Blue", teacherPhone: null },
  { level: "Junior School", class: "Grade 9", stream: "East", teacherPhone: "0711 000 003" },
];

const s = (
  n: number,
  firstName: string,
  lastName: string,
  gender: string,
  dob: string,
  cls: string,
  stream: string | null,
  boarding: string,
  extra: Row = {},
): Row => ({
  admissionNumber: `BA/2027/${String(n).padStart(3, "0")}`,
  upi: null,
  firstName,
  middleName: null,
  lastName,
  gender,
  dateOfBirth: dob,
  class: cls,
  stream,
  boarding,
  house: null,
  specialNeeds: null,
  medicalNotes: null,
  allergies: null,
  openingBalance: null,
  ...extra,
});

const students: Row[] = [
  s(1, "Amani", "Mwakio", "Male", "2015-02-11", "Grade 6", "Blue", "Day", {
    openingBalance: "8,500",
    upi: "BAK7Q2M1",
  }),
  s(2, "Rehema", "Chiro", "Female", "2015-06-23", "Grade 6", "Blue", "Boarder", {
    house: "Simba",
    openingBalance: "24,000",
  }),
  s(3, "Daudi", "Karisa", "Male", "2014-11-02", "Grade 6", "Blue", "Boarder", { house: "Chui" }),
  s(4, "Pendo", "Kazungu", "Female", "2015-01-30", "Grade 6", "Blue", "Day", {
    allergies: "Groundnuts",
  }),
  s(5, "Hamisi", "Baya", "Male", "2014-04-17", "Grade 7", "East", "Boarder", {
    house: "Ndovu",
    openingBalance: "-1,500",
  }),
  s(6, "Sifa", "Kamau", "Female", "2014-08-09", "Grade 7", "East", "Boarder", {
    house: "Simba",
    medicalNotes: "Mild asthma",
  }),
  s(7, "Kahindi", "Mwangome", "Male", "2014-12-01", "Grade 7", "West", "Day"),
  s(8, "Neema", "Tsuma", "Female", "2012-03-05", "Grade 9", "East", "Boarder", {
    house: "Tembo",
    openingBalance: "31,250.50",
  }),
  s(9, "Jabali", "Katana", "Male", "2012-07-19", "Grade 9", "East", "Boarder", { house: "Tembo" }),
  s(10, "Zuhura", "Salim", "Female", "2012-10-28", "Grade 9", "East", "Day", {
    specialNeeds: "Sits at the front (eyesight)",
  }),
  s(11, "Bakari", "Ngala", "Male", "2015-05-14", "Grade 6", "Blue", "Day"),
];

const g = (
  n: number,
  name: string,
  phone: CellValue,
  relationship: string,
  extra: Row = {},
): Row => ({
  admissionNumber: `BA/2027/${String(n).padStart(3, "0")}`,
  name,
  phone,
  relationship,
  language: null,
  receivesFees: null,
  receivesAcademics: null,
  receivesBoarding: null,
  authorisedToCollect: null,
  ...extra,
});

const guardians: Row[] = [
  g(1, "Esther Mwakio", "0748 000 001", "Mother", { language: "Kiswahili" }),
  g(1, "Joseph Mwakio", "748000002", "Father"),
  g(2, "Mwanaisha Chiro", "254748000003", "Mother"),
  g(3, "Kenga Karisa", "+254748000004", "Father"),
  g(3, "Kilifi Bursary Fund", "0110 480 005", "Sponsor"),
  g(4, "Grace Kazungu", "0748000006", "Mother", { authorisedToCollect: "Yes" }),
  g(5, "Fatuma Baya", "0748000007", "Guardian", {
    language: "Kiswahili",
    authorisedToCollect: "Yes",
  }),
  // Brian Kamau's mother (already in Kiota at Bahari): linked to the same parent account.
  g(6, "Wanjiku Kamau", "0744 000 001", "Mother"),
  g(7, "Rose Mwangome", "0748000009", "Mother"),
  g(8, "Hassan Tsuma", "0748000010", "Father"),
  g(9, "Mary Katana", "0748000011", "Mother"),
  g(10, "Omar Salim", "0748000012", "Father", { receivesBoarding: "No" }),
  // BA/2027/011 has no guardian: the preview shows a warning, not an error.
];

async function main() {
  const dir = path.resolve("docs/samples");
  await mkdir(dir, { recursive: true });

  await writeFile(
    path.join(dir, "kiota-import-sample.xlsx"),
    await buildWorkbook(lists, { Classes: classes, Students: students, Guardians: guardians }),
  );

  // Typical mistakes, one of each kind the preview explains.
  const badStudents = students.map((r) => ({ ...r }));
  badStudents[2].stream = "Purple"; // unknown stream
  badStudents[8].dateOfBirth = "2031-07-19"; // impossible date of birth
  badStudents.push({ ...students[0], firstName: "Copy" }); // duplicate admission number
  const badGuardians = guardians.map((r) => ({ ...r }));
  badGuardians[3].phone = "07123 456"; // invalid phone
  badGuardians[9].relationship = "Uncle"; // unknown relationship

  await writeFile(
    path.join(dir, "kiota-import-sample-with-errors.xlsx"),
    await buildWorkbook(lists, {
      Classes: classes,
      Students: badStudents,
      Guardians: badGuardians,
    }),
  );
  console.log(
    "Wrote docs/samples/kiota-import-sample.xlsx and kiota-import-sample-with-errors.xlsx",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
