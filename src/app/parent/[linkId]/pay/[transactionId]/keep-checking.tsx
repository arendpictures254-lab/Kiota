"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

const EVERY_SECONDS = 3;

/** While waiting for the M-Pesa PIN: look again every few seconds (a tiny request each time). */
export function KeepChecking({ waited }: { waited: number }) {
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    const id = setTimeout(
      () => router.replace(`${path}?waited=${waited + EVERY_SECONDS}`, { scroll: false }),
      EVERY_SECONDS * 1000,
    );
    return () => clearTimeout(id);
  }, [router, path, waited]);
  return (
    <span className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-egg-blue/40" aria-hidden>
      <span className="block h-full w-1/3 animate-pulse rounded-full bg-teal" />
    </span>
  );
}
