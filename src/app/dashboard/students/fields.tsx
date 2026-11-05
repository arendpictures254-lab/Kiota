/**
 * Form fields shared by the add-student and edit-student screens.
 * "Class and stream" is one dropdown (value "classId|streamId") so they can never disagree.
 */
import { Checkbox, Field, Select, TextArea } from "@/components/ui";
import type { Structure } from "@/lib/structure/service";
import { enabledClasses } from "@/lib/structure/service";
import { GENDERS, LANGUAGES, RELATIONSHIPS } from "@/lib/students/rules";

export function placementOptions(structure: Structure) {
  return enabledClasses(structure).flatMap((c) =>
    c.streams.length === 0
      ? [{ value: `${c.id}|`, label: c.name }]
      : c.streams.map((s) => ({ value: `${c.id}|${s.id}`, label: `${c.name} ${s.name}` })),
  );
}

/** Split the placement value back into classId / streamId for the service. */
export function withPlacement(f: Record<string, string>) {
  const [classId = "", streamId = ""] = (f.placement ?? "").split("|");
  return { ...f, classId, streamId };
}

export type StudentDefaults = Partial<{
  admissionNumber: string;
  upi: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  gender: string;
  dateOfBirth: string;
  placement: string;
  boarding: string;
  houseId: string | null;
  specialNeeds: string | null;
  medicalNotes: string | null;
  allergies: string | null;
}>;

export function StudentFields({
  structure,
  defaults = {},
  canMedical,
}: {
  structure: Structure;
  defaults?: StudentDefaults;
  canMedical: boolean;
}) {
  return (
    <>
      <Field
        label="Admission number"
        name="admissionNumber"
        defaultValue={defaults.admissionNumber}
        required
      />
      <Field
        label="First name"
        name="firstName"
        defaultValue={defaults.firstName}
        required
        autoComplete="off"
      />
      <Field
        label="Middle name"
        name="middleName"
        defaultValue={defaults.middleName ?? ""}
        hint="Optional"
        autoComplete="off"
      />
      <Field
        label="Last name"
        name="lastName"
        defaultValue={defaults.lastName}
        required
        autoComplete="off"
      />
      <Select
        label="Gender"
        name="gender"
        defaultValue={defaults.gender ?? ""}
        placeholder="Choose"
        required
        options={GENDERS}
      />
      <Field
        label="Date of birth"
        name="dateOfBirth"
        type="date"
        defaultValue={defaults.dateOfBirth}
        required
      />
      <Select
        label="Class and stream"
        name="placement"
        defaultValue={defaults.placement ?? ""}
        placeholder="Choose"
        required
        options={placementOptions(structure)}
      />
      <Select
        label="Boarder or day scholar"
        name="boarding"
        defaultValue={defaults.boarding ?? ""}
        placeholder="Choose"
        required
        options={[
          { value: "boarder", label: "Boarder" },
          { value: "day", label: "Day scholar" },
        ]}
      />
      <Select
        label="House"
        name="houseId"
        defaultValue={defaults.houseId ?? ""}
        placeholder="No house"
        options={structure.houses.map((h) => ({ value: h.id, label: h.name }))}
      />
      <Field
        label="UPI (NEMIS number)"
        name="upi"
        defaultValue={defaults.upi ?? ""}
        hint="Optional"
      />
      <TextArea
        label="Special needs"
        name="specialNeeds"
        defaultValue={defaults.specialNeeds ?? ""}
        hint="Optional"
      />
      {canMedical ? (
        <fieldset className="flex flex-col gap-4 rounded-2xl border border-status-overdue/20 p-4">
          <legend className="px-1 text-sm font-semibold text-status-overdue">
            Medical (restricted)
          </legend>
          <TextArea
            label="Medical notes"
            name="medicalNotes"
            defaultValue={defaults.medicalNotes ?? ""}
          />
          <TextArea label="Allergies" name="allergies" defaultValue={defaults.allergies ?? ""} />
        </fieldset>
      ) : null}
    </>
  );
}

export type GuardianDefaults = Partial<{
  name: string;
  relationship: string;
  language: string;
  receivesFees: boolean;
  receivesAcademics: boolean;
  receivesBoarding: boolean;
  authorisedToCollect: boolean;
  whatsapp: boolean;
}>;

/** Guardian fields. `prefix` (g1_, g2_...) lets several guardians share one form. */
export function GuardianFields({
  prefix = "",
  required = true,
  withPhone = true,
  defaults = {},
}: {
  prefix?: string;
  required?: boolean;
  withPhone?: boolean;
  defaults?: GuardianDefaults;
}) {
  const d = {
    receivesFees: true,
    receivesAcademics: true,
    receivesBoarding: true,
    authorisedToCollect: true,
    whatsapp: false,
    ...defaults,
  };
  return (
    <>
      <input type="hidden" name={`${prefix}flags`} value="1" />
      <Field
        label="Guardian's name"
        name={`${prefix}name`}
        defaultValue={d.name}
        required={required}
        autoComplete="off"
      />
      {withPhone ? (
        <Field
          label="Guardian's phone"
          name={`${prefix}phone`}
          type="tel"
          inputMode="tel"
          placeholder="0712 345 678"
          required={required}
          hint="If this parent already uses Kiota, their account is linked, not duplicated."
        />
      ) : null}
      <Select
        label="Relationship"
        name={`${prefix}relationship`}
        defaultValue={d.relationship ?? "mother"}
        options={RELATIONSHIPS}
      />
      <Select
        label="Messages in"
        name={`${prefix}language`}
        defaultValue={d.language ?? "en"}
        options={LANGUAGES}
      />
      <div className="flex flex-col gap-2">
        <Checkbox
          name={`${prefix}receivesFees`}
          label="Receives fee messages"
          defaultChecked={d.receivesFees}
        />
        <Checkbox
          name={`${prefix}receivesAcademics`}
          label="Receives results"
          defaultChecked={d.receivesAcademics}
        />
        <Checkbox
          name={`${prefix}receivesBoarding`}
          label="Receives boarding alerts"
          defaultChecked={d.receivesBoarding}
        />
        <Checkbox
          name={`${prefix}authorisedToCollect`}
          label="Authorised to collect at leave-out"
          defaultChecked={d.authorisedToCollect}
        />
        <Checkbox
          name={`${prefix}whatsapp`}
          label="Uses WhatsApp"
          description="Receipts can also go by WhatsApp. SMS is used when WhatsApp does not work."
          defaultChecked={d.whatsapp}
        />
      </div>
    </>
  );
}
