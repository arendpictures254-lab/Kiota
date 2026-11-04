import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Loading } from "@/components/ui";
import {
  addDormitoryAction,
  addHouseAction,
  removeDormitoryAction,
  removeHouseAction,
} from "../actions";
import { Section, SetupShell, loadSetup } from "../shared";

export const metadata: Metadata = { title: "Houses and dormitories · Kiota" };

export default function HousesPage() {
  return (
    <SetupShell title="Houses and dormitories">
      <Suspense fallback={<Loading />}>
        <Houses />
      </Suspense>
    </SetupShell>
  );
}

async function Houses() {
  const { structure } = await loadSetup();
  const beds = structure.dormitories.reduce((n, d) => n + d.bedCapacity, 0);
  return (
    <div className="flex flex-col gap-6">
      <Section title="Houses">
        {structure.houses.map((h) => (
          <Card key={h.id} className="flex items-center justify-between gap-3 py-3">
            <span className="font-semibold">{h.name}</span>
            <ActionForm
              action={removeHouseAction}
              submitLabel="Remove"
              variant="danger"
              className="w-28"
            >
              <input type="hidden" name="houseId" value={h.id} />
            </ActionForm>
          </Card>
        ))}
        <ActionForm action={addHouseAction} submitLabel="Add house" variant="secondary">
          <Field label="New house" name="name" id="house-name" placeholder="Simba" required />
        </ActionForm>
      </Section>

      <Section title={`Dormitories (${beds} beds)`}>
        <p className="text-sm text-ink/60">
          Allocating students to beds comes with the boarding module.
        </p>
        {structure.dormitories.map((d) => (
          <Card key={d.id} className="flex items-center justify-between gap-3 py-3">
            <span>
              <span className="font-semibold">{d.name}</span>{" "}
              <span className="text-ink/60">· {d.bedCapacity} beds</span>
            </span>
            <ActionForm
              action={removeDormitoryAction}
              submitLabel="Remove"
              variant="danger"
              className="w-28"
            >
              <input type="hidden" name="dormitoryId" value={d.id} />
            </ActionForm>
          </Card>
        ))}
        <ActionForm action={addDormitoryAction} submitLabel="Add dormitory" variant="secondary">
          <Field label="New dormitory" name="name" id="dorm-name" placeholder="Mnazi" required />
          <Field label="Beds" name="bedCapacity" type="number" min={1} max={1000} required />
        </ActionForm>
      </Section>
    </div>
  );
}
