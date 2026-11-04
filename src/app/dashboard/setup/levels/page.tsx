import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Card, Loading } from "@/components/ui";
import { setLevelEnabledAction } from "../actions";
import { SetupShell, loadSetup } from "../shared";

export const metadata: Metadata = { title: "Levels · Kiota" };

export default function LevelsPage() {
  return (
    <SetupShell title="Levels">
      <Suspense fallback={<Loading />}>
        <Levels />
      </Suspense>
    </SetupShell>
  );
}

async function Levels() {
  const { structure } = await loadSetup();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink/70">Switch on only the levels your school offers.</p>
      {structure.levels.map((level) => (
        <Card key={level.id} className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-heading text-lg font-bold">{level.name}</h2>
              <p className="text-sm text-ink/60">{level.classes.map((c) => c.name).join(", ")}</p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-sm font-semibold ${level.enabled ? "bg-status-paid/10 text-status-paid" : "bg-ink/5 text-ink/60"}`}
            >
              {level.enabled ? "On" : "Off"}
            </span>
          </div>
          <ActionForm
            action={setLevelEnabledAction}
            submitLabel={level.enabled ? `Switch off ${level.name}` : `Switch on ${level.name}`}
            variant="secondary"
          >
            <input type="hidden" name="levelId" value={level.id} />
            <input type="hidden" name="enabled" value={level.enabled ? "0" : "1"} />
          </ActionForm>
        </Card>
      ))}
    </div>
  );
}
