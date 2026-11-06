import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Button, ButtonLink, Loading, Select } from "@/components/ui";
import { deps } from "@/lib/actions";
import { getStructure, enabledClasses } from "@/lib/structure/service";
import { STATUSES, fullName } from "@/lib/students/rules";
import { PAGE_SIZE, listStudents, type StudentFilters } from "@/lib/students/service";
import { StudentsShell, loadStudentsActor } from "./shared";

export const metadata: Metadata = { title: "Students · Kiota" };

export default function StudentsPage({ searchParams }: PageProps<"/dashboard/students">) {
  return (
    <StudentsShell title="Students" back={{ href: "/dashboard", label: "Dashboard" }}>
      <Suspense fallback={<Loading />}>
        <Students searchParams={searchParams} />
      </Suspense>
    </StudentsShell>
  );
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

async function Students({ searchParams }: Pick<PageProps<"/dashboard/students">, "searchParams">) {
  const { actor } = await loadStudentsActor();
  const sp = await searchParams;
  const filters: StudentFilters = {
    q: one(sp.q),
    classId: one(sp.classId) || undefined,
    streamId: one(sp.streamId) || undefined,
    boarding: (["boarder", "day"] as const).find((b) => b === one(sp.boarding)),
    status: ([...STATUSES.map((s) => s.value), "all"] as const).find((s) => s === one(sp.status)),
    page: Number(one(sp.page) ?? 1) || 1,
  };
  const [{ students, total, page }, structure] = await Promise.all([
    listStudents(deps, actor, filters),
    getStructure(deps, actor),
  ]);
  const classes = enabledClasses(structure);
  const streams = classes.flatMap((c) =>
    c.streams.map((s) => ({ value: s.id, label: `${c.name} ${s.name}` })),
  );
  const ownStreamsOnly = !actor.permissions.has("students.view");

  const pageLink = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp))
      if (typeof v === "string" && k !== "page") params.set(k, v);
    params.set("page", String(p));
    return `/dashboard/students?${params}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 empty:hidden sm:flex-row sm:flex-wrap">
        {actor.permissions.has("students.edit") ? (
          <ButtonLink href="/dashboard/students/new">Add a student</ButtonLink>
        ) : null}
        {actor.permissions.has("import.run") ? (
          <ButtonLink href="/dashboard/students/import" variant="secondary">
            Import from Excel
          </ButtonLink>
        ) : null}
      </div>

      <form
        method="get"
        role="search"
        className="flex flex-col gap-3 rounded-2xl border border-ink/10 bg-white p-4 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="q" className="text-sm font-semibold text-ink">
            Search
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={filters.q ?? ""}
            placeholder="Name or admission number"
            className="h-12 rounded-xl border border-ink/20 bg-white px-4 text-base outline-none focus:border-teal focus:ring-2 focus:ring-teal/30"
          />
        </div>
        <details
          className="lg:order-last lg:col-span-2"
          open={!!(filters.classId || filters.streamId || filters.boarding || filters.status)}
        >
          <summary className="cursor-pointer text-sm font-semibold text-teal">Filters</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Select
              label="Class"
              name="classId"
              defaultValue={filters.classId ?? ""}
              placeholder="All classes"
              options={classes.map((c) => ({ value: c.id, label: c.name }))}
            />
            <Select
              label="Stream"
              name="streamId"
              defaultValue={filters.streamId ?? ""}
              placeholder="All streams"
              options={streams}
            />
            <Select
              label="Boarding"
              name="boarding"
              defaultValue={filters.boarding ?? ""}
              placeholder="Boarders and day scholars"
              options={[
                { value: "boarder", label: "Boarders" },
                { value: "day", label: "Day scholars" },
              ]}
            />
            <Select
              label="Status"
              name="status"
              defaultValue={filters.status ?? "active"}
              options={[...STATUSES, { value: "all", label: "All statuses" }]}
            />
          </div>
        </details>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <p className="text-sm text-ink/60">
        {total} student{total === 1 ? "" : "s"}
        {ownStreamsOnly ? " in your streams" : ""}
      </p>

      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3 [&>li]:min-w-0 [&>li>*]:h-full">
        {students.map((s) => (
          <li key={s.id}>
            <Link
              href={`/dashboard/students/${s.id}`}
              className="flex flex-col rounded-2xl border border-ink/10 bg-white p-4 hover:border-teal"
            >
              <span className="font-semibold text-ink">{fullName(s)}</span>
              <span className="text-sm text-ink/60">
                {s.admissionNumber} · {s.class.name}
                {s.stream ? ` ${s.stream.name}` : ""} · {s.boarder ? "Boarder" : "Day"}
                {s.status !== "active" ? ` · ${s.status}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {total > PAGE_SIZE ? (
        <div className="flex items-center justify-between gap-3">
          {page > 1 ? (
            <ButtonLink href={pageLink(page - 1)} variant="secondary">
              Previous
            </ButtonLink>
          ) : (
            <span />
          )}
          <span className="shrink-0 text-sm text-ink/60">
            Page {page} of {Math.ceil(total / PAGE_SIZE)}
          </span>
          {page * PAGE_SIZE < total ? (
            <ButtonLink href={pageLink(page + 1)} variant="secondary">
              Next
            </ButtonLink>
          ) : (
            <span />
          )}
        </div>
      ) : null}
    </div>
  );
}
