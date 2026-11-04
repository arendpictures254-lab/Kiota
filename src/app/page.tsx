import Image from "next/image";
import { ButtonLink } from "@/components/ui";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-cream px-6 py-16 text-center">
      <Image src="/brand/kiota-icon.svg" alt="" width={96} height={96} priority />
      <h1 className="mt-6 font-heading text-5xl font-bold tracking-tight text-teal sm:text-6xl">
        Kiota
      </h1>
      <p className="mt-3 text-lg text-ink sm:text-xl">Every child, one place.</p>
      <div className="mt-8 h-1 w-16 rounded-full bg-light-twig" aria-hidden="true" />
      <div className="mt-10 w-full max-w-xs">
        <ButtonLink href="/sign-in">Sign in</ButtonLink>
      </div>
    </main>
  );
}
