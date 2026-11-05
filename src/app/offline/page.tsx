import type { Metadata } from "next";
import { translator } from "@/lib/i18n";

export const metadata: Metadata = { title: "Offline · Kiota" };

const en = translator("en");
const sw = translator("sw");

/**
 * Shown by the service worker (public/sw.js) when a page cannot load without the internet.
 * Static and in both languages: it is cached ahead of time and shown without a server.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-10">
      <section className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-bold text-teal">{en("offline.title")}</h1>
        <p className="text-ink/80">{en("offline.body")}</p>
      </section>
      <section lang="sw" className="flex flex-col gap-2">
        <h2 className="font-heading text-xl font-bold text-teal">{sw("offline.title")}</h2>
        <p className="text-ink/80">{sw("offline.body")}</p>
      </section>
      <a
        href="/"
        className="inline-flex h-12 items-center justify-center rounded-xl bg-teal px-5 font-semibold text-white"
      >
        {en("offline.retry")} · {sw("offline.retry")}
      </a>
    </main>
  );
}
