"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  type MarkValue,
  type Scheme,
  formatTenths,
  gradeFor,
  parseMark,
  percentTenths,
  subjectResult,
} from "@/lib/academics/grading";
import { saveMarksAction } from "../../../actions";

type Assessment = {
  id: string;
  name: string;
  maxMarks: number;
  weight: number;
  submitted: boolean;
};
type Student = { id: string; firstName: string; lastName: string; admissionNumber: string };

export type MarkGridProps = {
  termId: string;
  streamId: string;
  subjectId: string;
  scheme: Scheme;
  assessments: Assessment[];
  students: Student[];
  marks: Record<string, string>;
  canEdit: boolean;
  /** After sign-off: changes need a reason (the Principal). */
  needsReason: boolean;
};

const key = (studentId: string, assessmentId: string) => `${studentId}:${assessmentId}`;

const wideQuery = "(min-width: 1024px)";
function useWide() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(wideQuery);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(wideQuery).matches,
    () => true,
  );
}

/** What a typed value shows next to it: the level, "Absent", "Exempt" or the problem. */
function preview(scheme: Scheme, a: Assessment, text: string) {
  const p = parseMark(text, a.maxMarks);
  if (p.kind === "clear") return { tone: "", text: "" };
  if (p.kind === "error") return { tone: "error", text: p.message };
  if (p.value.status === "absent") return { tone: "muted", text: "Absent" };
  if (p.value.status === "exempt") return { tone: "muted", text: "Exempt" };
  const level = gradeFor(scheme, percentTenths(p.value.scoreTenths!, a.maxMarks));
  return { tone: "ok", text: level?.code ?? "" };
}

const toneClass: Record<string, string> = {
  error: "text-status-overdue",
  muted: "text-ink/60",
  ok: "text-teal",
  "": "",
};

export function MarkGrid(props: MarkGridProps) {
  const { scheme, assessments, students, canEdit } = props;
  const wide = useWide();
  const [values, setValues] = useState<Record<string, string>>(props.marks);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "typing" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const dirty = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const latest = useRef(values);
  const reasonRef = useRef(reason);
  const flushRef = useRef<() => void>(() => {});
  useEffect(() => {
    latest.current = values;
    reasonRef.current = reason;
  }, [values, reason]);

  const schedule = useCallback((ms = 700) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), ms);
  }, []);

  const flush = useCallback(async () => {
    if (saving.current || dirty.current.size === 0) return;
    if (props.needsReason && !reasonRef.current.trim()) {
      setState("error");
      setMessage("Say why these marks change after sign-off, then they save.");
      return;
    }
    const keys = [...dirty.current];
    dirty.current.clear();
    saving.current = true;
    setState("saving");
    try {
      const entries = keys.map((k) => {
        const [studentId, assessmentId] = k.split(":");
        return { studentId, assessmentId, value: latest.current[k] ?? "" };
      });
      const r = await saveMarksAction({
        termId: props.termId,
        streamId: props.streamId,
        subjectId: props.subjectId,
        entries,
        reason: reasonRef.current,
      });
      if (r.error) {
        keys.forEach((k) => dirty.current.add(k));
        setState("error");
        setMessage(r.error);
      } else {
        setServerErrors((prev) => {
          const next = { ...prev };
          keys.forEach((k) => delete next[k]);
          r.errors.forEach((e) => (next[key(e.studentId, e.assessmentId)] = e.message));
          return next;
        });
        // Newer edits waiting: not "saved" yet (they go in the next save).
        setState(r.errors.length ? "error" : dirty.current.size ? "typing" : "saved");
        setMessage(
          r.errors.length
            ? `${r.errors.length} mark${r.errors.length === 1 ? " was" : "s were"} not saved: fix the red ones.`
            : "All changes saved",
        );
      }
    } catch {
      keys.forEach((k) => dirty.current.add(k));
      setState("error");
      setMessage("Not saved: check the connection. Kiota will try again as you type.");
    } finally {
      saving.current = false;
      if (dirty.current.size) schedule(1500);
    }
  }, [props.termId, props.streamId, props.subjectId, props.needsReason, schedule]);
  useEffect(() => {
    flushRef.current = () => void flush();
  }, [flush]);

  // Save what is left when leaving the page.
  useEffect(() => {
    const leave = () => void flush();
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, [flush]);

  const setCell = useCallback(
    (k: string, v: string) => {
      setValues((prev) => ({ ...prev, [k]: v }));
      dirty.current.add(k);
      setState("typing");
      schedule();
    },
    [schedule],
  );

  /** Paste a column (or block) from Excel: fills down (and right) from this cell. */
  const paste = (row: number, col: number, text: string) => {
    const lines = text.replace(/\r/g, "").replace(/\n$/, "").split("\n");
    if (lines.length < 2 && !lines[0].includes("\t")) return false;
    setValues((prev) => {
      const next = { ...prev };
      lines.forEach((line, i) => {
        const s = students[row + i];
        if (!s) return;
        line.split("\t").forEach((cell, j) => {
          const a = assessments[col + j];
          if (!a) return;
          const k = key(s.id, a.id);
          next[k] = cell.trim();
          dirty.current.add(k);
        });
      });
      return next;
    });
    schedule(300);
    return true;
  };

  const errorFor = (k: string, a: Assessment) => {
    const p = preview(scheme, a, values[k] ?? "");
    return p.tone === "error" ? p.text : serverErrors[k];
  };

  const termResult = useMemo(
    () => (studentId: string) => {
      const m = new Map<string, MarkValue>();
      for (const a of assessments) {
        const p = parseMark(values[key(studentId, a.id)] ?? "", a.maxMarks);
        if (p.kind === "mark") m.set(a.id, p.value);
      }
      const r = subjectResult(assessments, m);
      if (r.pctTenths === null)
        return r.status === "missing" ? "" : r.status === "absent" ? "Absent" : "Exempt";
      return `${formatTenths(Math.round(r.pctTenths / 10) * 10)}% ${gradeFor(scheme, r.pctTenths)?.code ?? ""}`;
    },
    [assessments, scheme, values],
  );

  const status = (
    <p
      role="status"
      aria-live="polite"
      className={`text-sm font-semibold ${state === "error" ? "text-status-overdue" : state === "saved" ? "text-status-paid" : "text-ink/60"}`}
    >
      {state === "saving"
        ? "Saving…"
        : state === "typing"
          ? "Typing…"
          : state === "idle"
            ? ""
            : message}
    </p>
  );

  const reasonBox =
    props.needsReason && canEdit ? (
      <div className="flex flex-col gap-1.5 rounded-xl bg-status-due/15 p-3">
        <label htmlFor="change-reason" className="text-sm font-semibold text-ink">
          Why do these marks change after sign-off? (recorded with each change)
        </label>
        <input
          id="change-reason"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            schedule(1200);
          }}
          className="h-12 rounded-xl border border-ink/20 bg-white px-4 text-base outline-none focus:border-teal"
        />
      </div>
    ) : null;

  if (!wide)
    return (
      <PhoneEntry
        {...props}
        values={values}
        setCell={setCell}
        errorFor={errorFor}
        status={status}
        reasonBox={reasonBox}
        termResult={termResult}
      />
    );

  // ---- Desktop grid ----
  const move = (row: number, col: number) => {
    const el = document.querySelector<HTMLInputElement>(`[data-cell="${row}-${col}"]`);
    el?.focus();
    el?.select();
  };
  return (
    <div className="flex flex-col gap-3">
      {reasonBox}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink/70">
          Type a mark, <b>A</b> for absent or <b>X</b> for exempt. Enter moves down, Tab moves
          right. Paste a column straight from Excel. Marks save as you type.
        </p>
        {status}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-ink/10 bg-white">
        <table className="w-full border-collapse text-sm" data-testid="mark-grid">
          <thead className="sticky top-0 bg-cream">
            <tr>
              <th scope="col" className="w-12 px-3 py-2 text-left font-semibold text-ink/60">
                #
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Student
              </th>
              {assessments.map((a) => (
                <th key={a.id} scope="col" className="w-40 px-3 py-2 text-left font-semibold">
                  {a.name}
                  <span className="block text-xs font-normal text-ink/60">
                    out of {a.maxMarks} · {a.weight}%{a.submitted ? " · submitted" : ""}
                  </span>
                </th>
              ))}
              <th scope="col" className="w-32 px-3 py-2 text-left font-semibold">
                Term
              </th>
            </tr>
          </thead>
          <tbody>
            {students.map((s, row) => (
              <tr key={s.id} className="border-t border-ink/5 even:bg-cream/40">
                <td className="px-3 py-1.5 text-ink/60">{row + 1}</td>
                <th scope="row" className="px-3 py-1.5 text-left font-normal">
                  <span className="font-semibold text-ink">
                    {s.firstName} {s.lastName}
                  </span>
                  <span className="ml-2 text-xs text-ink/60">{s.admissionNumber}</span>
                </th>
                {assessments.map((a, col) => {
                  const k = key(s.id, a.id);
                  const p = preview(scheme, a, values[k] ?? "");
                  const err = errorFor(k, a);
                  return (
                    <td key={a.id} className="px-3 py-1.5">
                      <span className="flex items-center gap-2">
                        <input
                          data-cell={`${row}-${col}`}
                          aria-label={`${s.firstName} ${s.lastName}: ${a.name}`}
                          aria-invalid={err ? true : undefined}
                          title={err}
                          value={values[k] ?? ""}
                          disabled={!canEdit}
                          inputMode="decimal"
                          autoComplete="off"
                          onChange={(e) => setCell(k, e.target.value)}
                          onFocus={(e) => e.target.select()}
                          onBlur={() => void flush()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === "ArrowDown") {
                              e.preventDefault();
                              move(row + 1, col);
                            } else if (e.key === "ArrowUp") {
                              e.preventDefault();
                              move(row - 1, col);
                            }
                          }}
                          onPaste={(e) => {
                            if (paste(row, col, e.clipboardData.getData("text")))
                              e.preventDefault();
                          }}
                          className="h-10 w-20 rounded-lg border border-ink/20 bg-white px-2 text-right text-base tabular-nums outline-none focus:border-teal focus:ring-2 focus:ring-teal/30 disabled:bg-ink/5 aria-invalid:border-status-overdue aria-invalid:bg-status-overdue/5"
                        />
                        <span
                          className={`w-14 text-xs font-bold ${toneClass[err ? "error" : p.tone]}`}
                        >
                          {err ?? p.text}
                        </span>
                      </span>
                    </td>
                  );
                })}
                <td className="px-3 py-1.5 font-semibold text-ink tabular-nums">
                  {termResult(s.id)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Phones: one assessment at a time, one student per row, a big number pad. */
function PhoneEntry(
  props: MarkGridProps & {
    values: Record<string, string>;
    setCell: (k: string, v: string) => void;
    errorFor: (k: string, a: Assessment) => string | undefined;
    status: ReactNode;
    reasonBox: ReactNode;
    termResult: (studentId: string) => string;
  },
) {
  const { assessments, students, scheme, values, setCell, canEdit } = props;
  const [current, setCurrent] = useState(
    () => assessments.find((a) => !a.submitted)?.id ?? assessments[0]?.id ?? "",
  );
  const a = assessments.find((x) => x.id === current) ?? assessments[0];
  if (!a) return null;
  const filled = students.filter((s) => (values[key(s.id, a.id)] ?? "") !== "").length;
  return (
    <div className="flex flex-col gap-3">
      {props.reasonBox}
      <div role="tablist" aria-label="Assessment" className="flex flex-wrap gap-2">
        {assessments.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={x.id === a.id}
            onClick={() => setCurrent(x.id)}
            className="min-h-11 rounded-full border border-ink/15 bg-white px-4 text-sm font-semibold aria-selected:border-teal aria-selected:bg-teal aria-selected:text-white"
          >
            {x.name}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink/70">
          Out of {a.maxMarks} · {filled} of {students.length} entered
        </p>
        {props.status}
      </div>
      <ul className="flex flex-col gap-2" data-testid="mark-list">
        {students.map((s, i) => {
          const k = key(s.id, a.id);
          const p = preview(scheme, a, values[k] ?? "");
          const err = props.errorFor(k, a);
          const v = values[k] ?? "";
          return (
            <li
              key={s.id}
              className="flex items-center gap-3 rounded-2xl border border-ink/10 bg-white p-3"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <label htmlFor={`m-${s.id}`} className="truncate font-semibold text-ink">
                  {s.firstName} {s.lastName}
                </label>
                <span className="text-xs text-ink/60">{s.admissionNumber}</span>
                <span className={`text-sm font-bold ${toneClass[err ? "error" : p.tone]}`}>
                  {err ?? p.text}
                </span>
              </div>
              <input
                id={`m-${s.id}`}
                data-phone-cell={i}
                aria-label={`${s.firstName} ${s.lastName}: ${a.name}`}
                aria-invalid={err ? true : undefined}
                value={v === "A" || v === "X" ? "" : v}
                placeholder={v === "A" ? "Abs" : v === "X" ? "Ex" : "–"}
                disabled={!canEdit}
                inputMode="decimal"
                enterKeyHint="next"
                autoComplete="off"
                onChange={(e) => setCell(k, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    document
                      .querySelector<HTMLInputElement>(`[data-phone-cell="${i + 1}"]`)
                      ?.focus();
                  }
                }}
                className="h-14 w-24 rounded-xl border border-ink/20 bg-white px-3 text-center text-2xl font-bold tabular-nums outline-none focus:border-teal focus:ring-2 focus:ring-teal/30 disabled:bg-ink/5 aria-invalid:border-status-overdue"
              />
              <div className="flex flex-col gap-1">
                {(["A", "X"] as const).map((code) => (
                  <button
                    key={code}
                    type="button"
                    disabled={!canEdit}
                    aria-pressed={v === code}
                    aria-label={`${s.firstName} ${s.lastName}: ${code === "A" ? "absent" : "exempt"}`}
                    onClick={() => setCell(k, v === code ? "" : code)}
                    className="h-11 w-11 rounded-lg border border-ink/15 text-sm font-bold text-ink/70 aria-pressed:border-teal aria-pressed:bg-teal aria-pressed:text-white"
                  >
                    {code === "A" ? "Abs" : "Ex"}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
