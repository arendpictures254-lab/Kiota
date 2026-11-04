"use client";

import { Button } from "./ui";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button type="button" onClick={() => window.print()} className="print:hidden">
      {label}
    </Button>
  );
}

export function CopyButton({ text, label = "Copy link" }: { text: string; label?: string }) {
  return (
    <Button
      type="button"
      variant="secondary"
      className="print:hidden"
      onClick={async (e) => {
        const btn = e.currentTarget;
        await navigator.clipboard.writeText(text).catch(() => {});
        btn.textContent = "Copied";
        setTimeout(() => (btn.textContent = label), 1500);
      }}
    >
      {label}
    </Button>
  );
}
