import { Translator } from "@/components/translator";

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-14">
      <header className="mb-8">
        <p className="text-xs font-semibold tracking-[0.22em] text-green uppercase">
          English → Naijá · Yorùbá
        </p>
        <h1 className="mt-2 font-display text-5xl tracking-tight text-ink sm:text-6xl">
          Pigin
        </h1>
        <p className="mt-3 max-w-xl text-lg leading-relaxed text-muted">
          Say it in English. Read it, then hear it, in Nigerian Pidgin and
          Yorùbá.
        </p>
      </header>
      <Translator />
    </div>
  );
}
