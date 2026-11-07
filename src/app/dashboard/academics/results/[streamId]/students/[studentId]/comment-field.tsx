"use client";

import { useState } from "react";

/** A comment box with the bank's suggestions: tap one to use it, then edit freely. */
export function CommentField({
  name,
  label,
  initial,
  suggestions,
  disabled,
}: {
  name: string;
  label: string;
  initial: string;
  suggestions: { id: string; band: string; text: string; fits: boolean }[];
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={name} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {suggestions.length && !disabled ? (
        <ul className="flex flex-wrap gap-2" aria-label={`Suggested: ${label}`}>
          {suggestions.slice(0, 6).map((s) => (
            <li key={s.id} className="min-w-0">
              <button
                type="button"
                onClick={() => setValue(s.text)}
                className={`min-h-11 rounded-xl border px-3 py-2 text-left text-sm [overflow-wrap:anywhere] ${s.fits ? "border-teal/40 bg-egg-blue/30" : "border-ink/10 bg-white"}`}
              >
                <span className="mr-1 text-xs font-bold text-teal">{s.band}</span>
                {s.text}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <textarea
        id={name}
        name={name}
        rows={3}
        maxLength={600}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        className="rounded-xl border border-ink/20 bg-white px-4 py-3 text-base outline-none focus:border-teal focus:ring-2 focus:ring-teal/30 disabled:bg-ink/5"
      />
    </div>
  );
}
