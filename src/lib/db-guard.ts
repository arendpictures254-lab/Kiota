/**
 * The school wall, enforced by code (development and tests only): every Prisma query on a
 * school-owned model (one with a `schoolId` field) must say which school it is about. Row-level
 * security already blocks other schools' rows; this catches the query that forgot to ask, so
 * the rule in CLAUDE.md does not depend on anyone's memory.
 *
 * Throws "School wall: Student.findMany has no schoolId condition (src/lib/x.ts:12:7)".
 * Accepted: `schoolId` in `where` (any value: an id, `{ in: [...] }`, or null for platform
 * rows), a compound unique key that includes it (`schoolId_name`), a `school` relation filter,
 * or any of those inside `AND`. Creates need `schoolId` (or `school`) in every row. Raw SQL is
 * not checked: write the `school_id` condition yourself.
 *
 * KIOTA_DB_GUARD=off turns it off; =report logs to .dev/school-wall.log instead of throwing
 * (to list every place at once).
 */
import { appendFileSync } from "node:fs";
import type { PrismaClient } from "@/generated/prisma/client";

const NEEDS_WHERE = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);
const CREATES = new Set(["create", "createMany", "createManyAndReturn"]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Whether a `where` names the school. Exported for tests. */
export function whereHasSchool(where: unknown): boolean {
  if (!isObj(where)) return false;
  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue;
    if (key === "schoolId" || key === "school") return true;
    if (key.includes("schoolId") && isObj(value)) return true; // compound unique key
    if (key === "AND") {
      const parts = Array.isArray(value) ? value : [value];
      if (parts.some(whereHasSchool)) return true;
    }
  }
  return false;
}

function rowHasSchool(row: unknown) {
  return isObj(row) && (row.schoolId !== undefined || row.school !== undefined);
}

/** Whether these query args name the school. Exported for tests. */
export function argsHaveSchool(operation: string, args: unknown): boolean {
  const a = isObj(args) ? args : {};
  if (CREATES.has(operation)) {
    const data = a.data;
    return Array.isArray(data) ? data.every(rowHasSchool) : rowHasSchool(data);
  }
  if (NEEDS_WHERE.has(operation)) return whereHasSchool(a.where);
  return true;
}

/** The first stack frame in our own code: where the query was written. */
function callSite(): string {
  const lines = (new Error().stack ?? "").split("\n").slice(1);
  const ours = lines.find(
    (l) =>
      !/node_modules|db-guard.ts:|db-core.ts:|generated[\\/]prisma|node:internal|<anonymous>/.test(
        l,
      ) && /\.(ts|tsx|js|mjs)/.test(l),
  );
  const m = ours && /\(?((?:[A-Za-z]:)?[^():]+:\d+:\d+)\)?\s*$/.exec(ours.trim());
  if (!m) return "unknown place";
  return m[1].replace(/\\/g, "/").replace(/^.*?(?=(src|prisma|scripts|tests)\/)/, "");
}

export class SchoolWallError extends Error {
  constructor(model: string, operation: string, site: string) {
    super(`School wall: ${model}.${operation} has no schoolId condition (${site})`);
    this.name = "SchoolWallError";
  }
}

export function schoolOwnedModels(client: PrismaClient): Set<string> {
  const dm = (
    client as unknown as {
      _runtimeDataModel?: { models: Record<string, { fields: { name: string }[] }> };
    }
  )._runtimeDataModel;
  if (!dm) throw new Error("db-guard: Prisma's model list is missing; update src/lib/db-guard.ts");
  return new Set(
    Object.entries(dm.models)
      // Session.schoolId is only the school a user picked: a platform table, not school data.
      .filter(([name, m]) => name !== "Session" && m.fields.some((f) => f.name === "schoolId"))
      .map(([name]) => name),
  );
}

export function guardEnabled(env = process.env) {
  return env.NODE_ENV !== "production" && env.KIOTA_DB_GUARD !== "off";
}

function violation(model: string, op: string) {
  const err = new SchoolWallError(model, op, callSite());
  if (process.env.KIOTA_DB_GUARD !== "report") throw err;
  appendFileSync(".dev/school-wall.log", `${err.message}\n`);
}

/**
 * Wrap an app-role client with the guard. A Proxy rather than a Prisma query extension: Prisma
 * runs queries lazily, after the caller's frame is gone, so only a check at call time can name
 * the line that wrote the query. Transactions and $extends (scopedDb) are wrapped too.
 */
export function withSchoolGuard(client: PrismaClient): PrismaClient {
  const owned = schoolOwnedModels(client);
  const delegates = new Map(
    [...owned].map((m) => [m.charAt(0).toLowerCase() + m.slice(1), m] as const),
  );

  const guardDelegate = (delegate: object, model: string) =>
    new Proxy(delegate, {
      get(target, op, receiver) {
        const value = Reflect.get(target, op, receiver);
        if (typeof value !== "function" || typeof op !== "string") return value;
        return (args?: unknown) => {
          if (!argsHaveSchool(op, args)) violation(model, op);
          return value.call(target, args);
        };
      },
    });

  const guardClient = <T extends object>(c: T): T =>
    new Proxy(c, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof prop !== "string") return value;
        const model = delegates.get(prop);
        if (model && value && typeof value === "object") return guardDelegate(value, model);
        if (prop === "$transaction" && typeof value === "function") {
          return (arg: unknown, ...rest: unknown[]) =>
            typeof arg === "function"
              ? value.call(
                  target,
                  (tx: object) => (arg as (t: object) => unknown)(guardClient(tx)),
                  ...rest,
                )
              : value.call(target, arg, ...rest);
        }
        if (prop === "$extends" && typeof value === "function") {
          return (...a: unknown[]) => guardClient(value.apply(target, a));
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

  return guardClient(client);
}
