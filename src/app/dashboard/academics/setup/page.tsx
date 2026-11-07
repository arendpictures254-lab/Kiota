import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Checkbox, Loading, Notice, Select } from "@/components/ui";
import { academicsSetup } from "@/lib/academics/setup";
import { deps } from "@/lib/actions";
import {
  competencyAction,
  levelGradingAction,
  reportSettingsAction,
  schemeLevelsAction,
} from "../actions";
import { AcademicsShell, loadAcademicsActor } from "../shared";

export const metadata: Metadata = { title: "Grading and report cards · Kiota" };

export default function AcademicsSetupPage() {
  return (
    <AcademicsShell title="Grading and report cards">
      <Suspense fallback={<Loading />}>
        <Setup />
      </Suspense>
    </AcademicsShell>
  );
}

const cell = "h-11 w-full min-w-0 rounded-lg border border-ink/20 bg-white px-2 text-base";

async function Setup() {
  const { actor } = await loadAcademicsActor();
  if (!actor.permissions.has("academics.setup"))
    return (
      <Notice tone="error">Grading is set up by the Director of Studies or the Principal.</Notice>
    );
  const s = await academicsSetup(deps, actor);
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="levels" className="flex flex-col gap-3">
        <h2 id="levels" className="text-section font-bold">
          Levels
        </h2>
        <p className="text-sm text-ink/70">
          The grading scheme each level uses, and whether report cards show positions in the stream
          and class. Positions are off for CBC levels and on for 8-4-4 unless you choose.
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {s.levels.map((l) => (
            <ActionForm
              key={l.id}
              action={levelGradingAction}
              submitLabel="Save"
              variant="secondary"
              className="flex flex-col gap-3 rounded-2xl border border-ink/10 bg-white p-4"
            >
              <h3 className="font-bold">{l.name}</h3>
              <input type="hidden" name="levelId" value={l.id} />
              <Select
                label="Grading scheme"
                name="schemeId"
                id={`scheme-${l.id}`}
                defaultValue={l.ownScheme ? (l.schemeId ?? "") : ""}
                placeholder={`Default (${l.schemeName})`}
                options={s.schemes.map((x) => ({ value: x.id, label: x.name }))}
              />
              <Select
                label="Positions"
                name="positions"
                id={`pos-${l.id}`}
                defaultValue={l.showPositions === null ? "default" : l.showPositions ? "on" : "off"}
                options={[
                  {
                    value: "default",
                    label: `Scheme default (${l.positions ? "shown" : "hidden"})`,
                  },
                  { value: "on", label: "Show positions" },
                  { value: "off", label: "Hide positions" },
                ]}
              />
            </ActionForm>
          ))}
        </div>
      </section>

      <section aria-labelledby="report" className="flex flex-col gap-3">
        <h2 id="report" className="text-section font-bold">
          Report cards
        </h2>
        <ActionForm
          action={reportSettingsAction}
          submitLabel="Save report card settings"
          className="flex max-w-3xl flex-col gap-3"
        >
          <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">Template</legend>
            {[
              ["classic", "Classic", "A ruled table, school colours in the headings"],
              ["modern", "Modern", "A teal band at the top, soft rows"],
            ].map(([v, label, d]) => (
              <label
                key={v}
                className="flex cursor-pointer gap-3 rounded-xl border border-ink/10 bg-white p-3 has-checked:border-teal has-checked:bg-egg-blue/20"
              >
                <input
                  type="radio"
                  name="template"
                  value={v}
                  defaultChecked={s.report.template === v}
                  className="mt-1 size-5 accent-teal"
                />
                <span className="flex flex-col">
                  <span className="font-semibold">{label}</span>
                  <span className="text-sm text-ink/60">{d}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="text-sm text-ink/60">
            Matching a sample report card the school already uses comes later: send it to Arend
            Studio.
          </p>
          <Checkbox
            name="showFeeBalance"
            label="Show the fee balance"
            defaultChecked={s.report.showFeeBalance}
          />
          <Checkbox
            name="showNextTerm"
            label="Show next term's opening date"
            defaultChecked={s.report.showNextTerm}
          />
        </ActionForm>
      </section>

      <section aria-labelledby="schemes" className="flex flex-col gap-3">
        <h2 id="schemes" className="text-section font-bold">
          Grading schemes
        </h2>
        <p className="text-sm text-ink/70">
          A mark takes the highest level whose lowest mark it reaches, after rounding to a whole
          mark (89.5 becomes 90). The mean grade comes from the average points.
        </p>
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
          {s.schemes.map((x) => {
            const rows = [
              ...x.levels,
              { id: "new", code: "", label: "", points: 0, minMark: 0, maxMark: 0, comment: "" },
            ];
            return (
              <ActionForm
                key={x.id}
                action={schemeLevelsAction}
                submitLabel={`Save ${x.name}`}
                variant="secondary"
                className="flex min-w-0 flex-col gap-3 rounded-2xl border border-ink/10 bg-white p-4"
              >
                <h3 className="font-bold">{x.name}</h3>
                {x.note ? (
                  <p className="rounded-lg bg-status-due/15 p-2 text-sm font-semibold">{x.note}</p>
                ) : null}
                <input type="hidden" name="schemeId" value={x.id} />
                <input type="hidden" name="rows" value={rows.length} />
                <div className="hidden grid-cols-[4rem_minmax(0,1fr)_3.5rem_3.5rem_3.5rem] gap-1 text-xs font-semibold text-ink/60 sm:grid lg:grid-cols-[4rem_minmax(0,1fr)_3.5rem_3.5rem_3.5rem_minmax(0,1.4fr)]">
                  <span>Code</span>
                  <span>Label</span>
                  <span>Points</span>
                  <span>From</span>
                  <span>To</span>
                  <span className="hidden lg:block">Default comment</span>
                </div>
                {rows.map((l, i) => (
                  <div
                    key={l.id}
                    className="grid grid-cols-[4rem_minmax(0,1fr)_3.5rem_3.5rem_3.5rem] gap-1 lg:grid-cols-[4rem_minmax(0,1fr)_3.5rem_3.5rem_3.5rem_minmax(0,1.4fr)]"
                  >
                    <input
                      aria-label={`Level ${i + 1} code`}
                      name={`code-${i}`}
                      defaultValue={l.code}
                      className={cell}
                    />
                    <input
                      aria-label={`Level ${i + 1} label`}
                      name={`label-${i}`}
                      defaultValue={l.label}
                      className={cell}
                    />
                    <input
                      aria-label={`Level ${i + 1} points`}
                      name={`points-${i}`}
                      defaultValue={l.code ? l.points : ""}
                      inputMode="numeric"
                      className={cell}
                    />
                    <input
                      aria-label={`Level ${i + 1} lowest mark`}
                      name={`min-${i}`}
                      defaultValue={l.code ? l.minMark : ""}
                      inputMode="numeric"
                      className={cell}
                    />
                    <input
                      aria-label={`Level ${i + 1} highest mark`}
                      name={`max-${i}`}
                      defaultValue={l.code ? l.maxMark : ""}
                      inputMode="numeric"
                      className={cell}
                    />
                    <input
                      aria-label={`Level ${i + 1} comment`}
                      name={`comment-${i}`}
                      defaultValue={l.comment ?? ""}
                      className={`${cell} col-span-5 lg:col-span-1`}
                    />
                  </div>
                ))}
              </ActionForm>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="competencies" className="flex flex-col gap-3">
        <h2 id="competencies" className="text-section font-bold">
          Core competencies and values
        </h2>
        <p className="text-sm text-ink/70">Rated by the class teacher on the 4-level rubric.</p>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {(["competency", "value"] as const).map((kind) => (
            <div
              key={kind}
              className="flex flex-col gap-2 rounded-2xl border border-ink/10 bg-white p-4"
            >
              <h3 className="font-bold">
                {kind === "competency" ? "Core competencies" : "Values"}
              </h3>
              {s.competencies
                .filter((c) => c.kind === kind)
                .map((c) => (
                  <ActionForm
                    key={c.id}
                    action={competencyAction}
                    submitLabel="Save"
                    variant="secondary"
                    className="grid grid-cols-[minmax(0,1fr)_auto_6rem] items-center gap-2"
                  >
                    <input type="hidden" name="id" value={c.id} />
                    <input aria-label="Name" name="name" defaultValue={c.name} className={cell} />
                    <select
                      aria-label={`${c.name}: in use`}
                      name="active"
                      defaultValue={c.active ? "on" : "off"}
                      className="h-11 rounded-lg border border-ink/20 bg-white px-2"
                    >
                      <option value="on">In use</option>
                      <option value="off">Not used</option>
                    </select>
                  </ActionForm>
                ))}
              <ActionForm
                action={competencyAction}
                submitLabel="Add"
                variant="secondary"
                className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2 border-t border-ink/10 pt-2"
              >
                <input type="hidden" name="kind" value={kind} />
                <input
                  aria-label={`New ${kind}`}
                  name="name"
                  placeholder={`Add a ${kind}`}
                  className={cell}
                />
              </ActionForm>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
