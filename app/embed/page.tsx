import { Translator } from "@/components/translator";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pigin Translator — embed",
  description:
    "The Pigin Translator widget: English into Nigerian Pidgin (Naijá) and Yorùbá, made to be embedded anywhere.",
};

/**
 * Embeddable translator: the same Translator as the home page, in a
 * compact frame-friendly layout. Framing is allowed for
 * crustaceansoftware.ca (see next.config.ts frame-ancestors) — anyone
 * else who wants it on their site, just ask.
 */
export default function EmbedPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-5 sm:px-5">
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-display text-2xl tracking-tight text-ink">
          Pigin <span className="text-green">Translator</span>
        </p>
        <p className="text-[11px] font-semibold tracking-[0.22em] text-green uppercase">
          English → Naijá · Yorùbá
        </p>
      </header>
      <Translator />
      <footer className="mt-6 border-t border-line pt-3 text-xs text-muted">
        Pigin Translator by{" "}
        <a
          href="https://crustaceansoftware.ca"
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-green underline-offset-2 hover:underline"
        >
          Crustacean Software
        </a>{" "}
        — computer translation anyone can use.{" "}
        <a
          href="https://pigin-translator.vercel.app"
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-green underline-offset-2 hover:underline"
        >
          Open the full site
        </a>
      </footer>
    </div>
  );
}
