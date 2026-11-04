import Image from "next/image";
import Link from "next/link";
import { APP_URL, WHATSAPP_DISPLAY, WHATSAPP_URL } from "@/lib/hosts";

/** Layout for the public site (kiota.app). The proxy maps kiota.app/x to /site/x. */
export default function SiteLayout({ children }: LayoutProps<"/site">) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-cream">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:rounded-lg focus:bg-white focus:p-3"
      >
        Skip to content
      </a>
      <header className="border-b border-ink/10">
        <nav
          aria-label="Main"
          className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-4"
        >
          <Link href="/" className="flex items-center" aria-label="Kiota home">
            <Image
              src="/brand/kiota-logo-horizontal.svg"
              alt="Kiota"
              width={139}
              height={40}
              priority
            />
          </Link>
          <div className="flex items-center gap-1 text-sm font-semibold sm:gap-4">
            <Link
              href="/features"
              className="hidden rounded-lg px-2 py-2 text-ink hover:text-teal sm:block"
            >
              Features
            </Link>
            <Link
              href="/parents"
              className="hidden rounded-lg px-2 py-2 text-ink hover:text-teal sm:block"
            >
              For parents
            </Link>
            <Link
              href="/security"
              className="hidden rounded-lg px-2 py-2 text-ink hover:text-teal md:block"
            >
              Security
            </Link>
            <a
              href={`${APP_URL}/sign-in`}
              className="rounded-lg px-2 py-2 text-teal hover:underline"
            >
              Sign in
            </a>
            <Link
              href="/demo"
              className="rounded-xl bg-teal px-4 py-2.5 text-white hover:bg-teal/90"
            >
              Book a demo
            </Link>
          </div>
        </nav>
      </header>

      <main id="main" className="flex flex-1 flex-col">
        {children}
      </main>

      <footer className="border-t border-ink/10 bg-ink text-cream">
        <div className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-10 sm:grid-cols-3">
          <div className="flex flex-col gap-3">
            <Image
              src="/brand/kiota-logo-horizontal-on-dark.svg"
              alt="Kiota"
              width={125}
              height={36}
            />
            <p className="text-sm text-cream/80">Kiota is built by Arend Studio, Nairobi.</p>
          </div>
          <nav aria-label="Footer" className="flex flex-col gap-2 text-sm">
            <Link href="/features" className="hover:underline">
              Features
            </Link>
            <Link href="/parents" className="hover:underline">
              For parents
            </Link>
            <Link href="/security" className="hover:underline">
              Security and privacy
            </Link>
            <Link href="/demo" className="hover:underline">
              Book a demo
            </Link>
          </nav>
          <div className="flex flex-col gap-2 text-sm">
            <a href={WHATSAPP_URL} className="hover:underline" rel="noopener">
              WhatsApp {WHATSAPP_DISPLAY}
            </a>
            <Link href="/privacy" className="hover:underline">
              Privacy policy
            </Link>
            <Link href="/terms" className="hover:underline">
              Terms
            </Link>
          </div>
        </div>
        <p className="mx-auto w-full max-w-5xl px-4 pb-8 text-xs text-cream/60">
          © {2026} Arend Studio. Kiota accounts are set up by your school; there is no self sign-up.
        </p>
      </footer>
    </div>
  );
}
