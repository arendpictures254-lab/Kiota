"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

/**
 * Tables, the Kiota way (CLAUDE.md, "Responsive design"):
 *  - from 1024 px a full table: sticky header, sortable columns, sensible widths;
 *  - below that, stacked rows showing the two or three fields that matter, each opening the
 *    details when it has a link. Never a table that scrolls sideways on a phone.
 */
export type Column = {
  key: string;
  label: string;
  align?: "left" | "right";
  /** e.g. "12rem" or "30%". */
  width?: string;
  sortable?: boolean;
};

export type Cell = { node: ReactNode; sort?: string | number };

export type Row = { id: string; href?: string; cells: Record<string, Cell> };

export function DataTable({
  columns,
  rows,
  mobile,
  caption,
  empty = "Nothing to show.",
  footer,
}: {
  columns: Column[];
  rows: Row[];
  /** What a phone row shows: a title, a line under it, and a value on the right. */
  mobile: { title: string; subtitle?: string[]; value?: string };
  caption?: string;
  empty?: string;
  /** A totals row (desktop) / line (phone). */
  footer?: Record<string, ReactNode>;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((a, b) => {
      const x = a.cells[sort.key]?.sort ?? "";
      const y = b.cells[sort.key]?.sort ?? "";
      return (
        (typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y))) * sort.dir
      );
    });
  }, [rows, sort]);

  if (rows.length === 0) return <p className="text-ink/60">{empty}</p>;

  const toggle = (key: string) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  return (
    <>
      {/* Laptop and larger: the full table */}
      <div className="hidden rounded-2xl border border-ink/10 bg-white lg:block">
        <table className="w-full table-fixed border-collapse text-sm">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <colgroup>
            {columns.map((c) => (
              <col key={c.key} style={c.width ? { width: c.width } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort!.dir === 1 ? "ascending" : "descending") : undefined}
                    className={`sticky top-0 z-10 border-b border-ink/10 bg-white px-4 py-3 font-semibold text-ink/70 first:rounded-tl-2xl last:rounded-tr-2xl ${
                      c.align === "right" ? "text-right" : "text-left"
                    }`}
                  >
                    {c.sortable === false ? (
                      c.label
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggle(c.key)}
                        className={`inline-flex items-center gap-1 rounded hover:text-ink ${c.align === "right" ? "flex-row-reverse" : ""}`}
                      >
                        {c.label}
                        <span aria-hidden className="text-xs">
                          {active ? (sort!.dir === 1 ? "▲" : "▼") : "↕"}
                        </span>
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr
                key={r.id}
                className="border-b border-ink/5 align-top last:border-0 hover:bg-egg-blue/10"
              >
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    className={`px-4 py-3 break-words ${c.align === "right" ? "text-right tabular-nums" : ""}`}
                  >
                    {i === 0 && r.href ? (
                      <Link href={r.href} className="font-semibold text-teal hover:underline">
                        {r.cells[c.key]?.node}
                      </Link>
                    ) : (
                      r.cells[c.key]?.node
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer ? (
            <tfoot>
              <tr className="border-t border-ink/15 font-semibold">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-4 py-3 ${c.align === "right" ? "text-right tabular-nums" : ""}`}
                  >
                    {footer[c.key]}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {/* Phones and tablets: stacked rows */}
      <ul className="flex flex-col divide-y divide-ink/5 rounded-2xl border border-ink/10 bg-white lg:hidden">
        {sorted.map((r) => {
          const inner = (
            <>
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold text-ink">{r.cells[mobile.title]?.node}</span>
                {mobile.subtitle?.length ? (
                  <span className="text-sm text-ink/60">
                    {mobile.subtitle.map((k, i) => (
                      <span key={k}>
                        {i ? " · " : ""}
                        {(() => {
                          const label = columns.find((c) => c.key === k)?.label;
                          return label ? `${label}: ` : "";
                        })()}
                        {r.cells[k]?.node}
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
              {mobile.value ? (
                <span className="shrink-0 text-right font-semibold tabular-nums">
                  {r.cells[mobile.value]?.node}
                </span>
              ) : null}
            </>
          );
          return (
            <li key={r.id}>
              {r.href ? (
                <Link
                  href={r.href}
                  className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-egg-blue/10"
                >
                  {inner}
                  <span aria-hidden className="text-teal">
                    →
                  </span>
                </Link>
              ) : (
                <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
                  {inner}
                </div>
              )}
            </li>
          );
        })}
        {footer && mobile.value ? (
          <li className="flex min-h-12 items-center justify-between gap-3 bg-cream/60 px-4 py-3 font-semibold">
            <span>{footer[mobile.title]}</span>
            <span className="tabular-nums">{footer[mobile.value]}</span>
          </li>
        ) : null}
      </ul>
    </>
  );
}
