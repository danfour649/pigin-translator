"use client";

import {
  EXAMPLE_PHRASES,
  LANGUAGES,
  MAX_SOURCE_LENGTH,
  type LanguageId,
} from "@/lib/languages";
import {
  chooseVoice,
  createRecognition,
  loadVoices,
  recognitionSupported,
  synthesisSupported,
} from "@/lib/speech";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type Phase = "idle" | "listening" | "translating" | "speaking";

type ReadyState = {
  ready: boolean;
  provider: string | null;
};

const PROVIDER_LABELS: Record<string, string> = {
  "ai-gateway": "AI Gateway",
  openai: "OpenAI",
  anthropic: "Anthropic",
};

export function Translator() {
  const [text, setText] = useState("");
  const [language, setLanguage] = useState<LanguageId>("naija");
  const [interim, setInterim] = useState("");
  const [translation, setTranslation] = useState("");
  const [translatedLanguage, setTranslatedLanguage] =
    useState<LanguageId>("naija");
  const [provider, setProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [ready, setReady] = useState<ReadyState | null>(null);
  const [azureReady, setAzureReady] = useState(false);
  const [azureVoices, setAzureVoices] = useState<
    Partial<Record<LanguageId, string>>
  >({});
  const canListen = useSyncExternalStore(
    subscribeBrowser,
    recognitionSupported,
    () => false,
  );
  const canSpeak = useSyncExternalStore(
    subscribeBrowser,
    synthesisSupported,
    () => false,
  );

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const copyTimer = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const speakGen = useRef(0);
  const azureState = useRef<{ known: boolean; ready: boolean }>({
    known: false,
    ready: false,
  });

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      speakGen.current += 1;
      haltPlayback(audioRef, audioUrlRef);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/translate", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Status check failed");
        return (await response.json()) as ReadyState;
      })
      .then((data) => setReady(data))
      .catch((fetchError: unknown) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") {
          return;
        }
        setReady({ ready: false, provider: null });
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/speak", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Speech status check failed");
        return (await response.json()) as {
          configured?: boolean;
          voices?: Partial<Record<LanguageId, string>>;
        };
      })
      .then((data) => {
        const configured = Boolean(data.configured);
        azureState.current = { known: true, ready: configured };
        setAzureReady(configured);
        setAzureVoices(data.voices ?? {});
      })
      .catch((fetchError: unknown) => {
        if (
          fetchError instanceof DOMException &&
          fetchError.name === "AbortError"
        ) {
          return;
        }
        setAzureReady(false);
      });

    return () => controller.abort();
  }, []);

  const target = LANGUAGES[language];
  const resultLanguage = translation
    ? LANGUAGES[translatedLanguage]
    : LANGUAGES[language];

  async function onTranslate() {
    const source = text.trim();
    if (!source || phase === "translating") return;

    stopListening();
    stopSpeaking();
    setError(null);
    setVoiceNote(null);
    setCopied(false);
    setPhase("translating");

    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: source, language }),
      });
      const data = (await response.json()) as {
        translation?: string;
        provider?: string;
        error?: string;
      };

      if (!response.ok || !data.translation) {
        throw new Error(data.error ?? "Translation failed.");
      }

      setTranslation(data.translation);
      setTranslatedLanguage(language);
      setProvider(data.provider ?? null);
    } catch (translateError) {
      setTranslation("");
      setError(
        translateError instanceof Error
          ? translateError.message
          : "Translation failed.",
      );
    } finally {
      setPhase("idle");
    }
  }

  function toggleListening() {
    const recognition = recognitionRef.current ?? createRecognition();
    if (!recognition) return;
    recognitionRef.current = recognition;

    if (phase === "listening") {
      recognition.stop();
      return;
    }

    stopSpeaking();
    setError(null);
    setInterim("");
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";

      for (let index = event.resultIndex; index < event.results.length; index++) {
        const transcript = event.results[index]?.[0]?.transcript ?? "";
        if (event.results[index]?.isFinal) finalText += transcript;
        else interimText += transcript;
      }

      if (finalText.trim()) {
        setText((current) => joinTranscript(current, finalText));
      }
      setInterim(interimText);
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      setError(recognitionErrorMessage(event.error));
      setPhase("idle");
    };
    recognition.onend = () => {
      setInterim("");
      setPhase((current) => (current === "listening" ? "idle" : current));
    };

    try {
      recognition.start();
      setPhase("listening");
    } catch {
      setError("The microphone is already in use. Stop it, then try again.");
    }
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setInterim("");
    setPhase((current) => (current === "listening" ? "idle" : current));
  }

  async function loadAzureStatus() {
    try {
      const response = await fetch("/api/speak");
      if (!response.ok) throw new Error("Speech status check failed");
      const data = (await response.json()) as {
        configured?: boolean;
        voices?: Partial<Record<LanguageId, string>>;
      };
      const configured = Boolean(data.configured);
      azureState.current = { known: true, ready: configured };
      setAzureReady(configured);
      setAzureVoices(data.voices ?? {});
      return configured;
    } catch {
      azureState.current = { known: true, ready: false };
      setAzureReady(false);
      return false;
    }
  }

  async function onSpeak() {
    if (!translation || translating) return;

    const generation = ++speakGen.current;
    haltPlayback(audioRef, audioUrlRef);
    setError(null);
    setPhase("speaking");

    const useAzure = azureState.current.known
      ? azureState.current.ready
      : await loadAzureStatus();
    if (speakGen.current !== generation) return;

    if (!useAzure && !canSpeak) {
      setPhase("idle");
      setVoiceNote("This browser could not play the translation.");
      return;
    }

    if (useAzure) {
      const played = await speakWithAzure(
        translation,
        translatedLanguage,
        generation,
      );
      if (played || speakGen.current !== generation) return;
    }

    if (!canSpeak) {
      setPhase("idle");
      setVoiceNote("This browser could not play the translation.");
      return;
    }

    await speakWithBrowser(translation, translatedLanguage, generation);
  }

  async function speakWithAzure(
    spoken: string,
    spokenLanguage: LanguageId,
    generation: number,
  ) {
    try {
      const response = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: spoken, language: spokenLanguage }),
      });
      if (speakGen.current !== generation) return true;
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !contentType.startsWith("audio/")) return false;

      const url = URL.createObjectURL(await response.blob());
      if (speakGen.current !== generation) {
        URL.revokeObjectURL(url);
        return true;
      }

      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      const voiceName =
        azureVoices[spokenLanguage] ??
        (spokenLanguage === "yoruba"
          ? "yo-NG-AdeolaNeural"
          : "en-NG-EzinneNeural");
      setVoiceNote(`Speaking with Azure ${voiceName}.`);
      audio.onended = () => {
        if (speakGen.current !== generation) return;
        setPhase("idle");
        releaseAudioUrl(audioUrlRef, url);
      };
      await audio.play();
      return true;
    } catch {
      if (speakGen.current !== generation) return true;
      haltPlayback(audioRef, audioUrlRef);
      return false;
    }
  }

  async function speakWithBrowser(
    spoken: string,
    spokenLanguage: LanguageId,
    generation: number,
  ) {
    if (!synthesisSupported() || speakGen.current !== generation) return;

    window.speechSynthesis.cancel();
    const voices = await loadVoices();
    if (speakGen.current !== generation) return;

    const choice = chooseVoice(spokenLanguage, voices);
    const utterance = new SpeechSynthesisUtterance(spoken);
    if (choice.voice) {
      utterance.voice = choice.voice;
      utterance.lang = choice.voice.lang;
    } else {
      utterance.lang = spokenLanguage === "yoruba" ? "yo-NG" : "en-NG";
    }
    utterance.rate = 0.95;
    utterance.onend = () => {
      if (speakGen.current === generation) setPhase("idle");
    };
    utterance.onerror = () => {
      if (speakGen.current !== generation) return;
      setPhase("idle");
      setVoiceNote("This browser could not play the translation.");
    };

    setVoiceNote(choice.note);
    setPhase("speaking");
    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    speakGen.current += 1;
    haltPlayback(audioRef, audioUrlRef);
    setPhase((current) => (current === "speaking" ? "idle" : current));
  }

  async function onCopy() {
    if (!translation) return;
    try {
      await navigator.clipboard.writeText(translation);
      setCopied(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copying was blocked by the browser.");
    }
  }

  const providerLabel = provider ? PROVIDER_LABELS[provider] ?? provider : null;
  const listening = phase === "listening";
  const translating = phase === "translating";
  const canPlay = canSpeak || azureReady;

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-3xl border border-line bg-card p-4 shadow-[0_18px_50px_rgb(28_22_18_/_0.06)] sm:p-6">
        <div
          className="grid grid-cols-2 gap-2 rounded-2xl bg-paper p-1"
          role="radiogroup"
          aria-label="Translation language"
        >
          {(Object.keys(LANGUAGES) as LanguageId[]).map((id) => {
            const item = LANGUAGES[id];
            const selected = language === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setLanguage(id)}
                className={`rounded-xl px-3 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green ${
                  selected
                    ? "bg-green text-card"
                    : "text-ink hover:bg-white"
                }`}
              >
                <span className="block font-display text-2xl leading-none">
                  {item.label}
                </span>
                <span
                  className={`mt-1 block text-sm ${selected ? "text-card/80" : "text-muted"}`}
                >
                  {item.description}
                </span>
              </button>
            );
          })}
        </div>

        <label htmlFor="english" className="mt-6 block text-sm font-semibold">
          English
        </label>
        <div className="relative mt-2">
          <textarea
            id="english"
            value={text}
            maxLength={MAX_SOURCE_LENGTH}
            rows={6}
            placeholder="Type English, or use the microphone."
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void onTranslate();
              }
            }}
            className="w-full resize-y rounded-2xl border border-line bg-white px-4 py-3 pr-16 text-base leading-relaxed text-ink outline-none placeholder:text-muted/70 focus-visible:border-green focus-visible:ring-2 focus-visible:ring-green/30"
          />
          <button
            type="button"
            onClick={toggleListening}
            disabled={!canListen || translating}
            aria-pressed={listening}
            className={`absolute right-3 bottom-3 flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green disabled:cursor-not-allowed disabled:opacity-40 ${
              listening
                ? "listening bg-clay text-card"
                : "bg-green-ink text-card hover:bg-green"
            }`}
          >
            <MicIcon />
            <span className="sr-only">
              {listening ? "Stop microphone" : "Start microphone"}
            </span>
          </button>
        </div>
        <div className="mt-2 flex items-start justify-between gap-3 text-sm text-muted">
          <p aria-live="polite">
            {listening
              ? interim || "Listening for English…"
              : canListen
                ? "The microphone listens for English."
                : "This browser cannot use the microphone. Type instead."}
          </p>
          <p className="shrink-0 tabular-nums">
            {text.length}/{MAX_SOURCE_LENGTH}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2" aria-label="Example phrases">
          {EXAMPLE_PHRASES.map((phrase) => (
            <button
              key={phrase}
              type="button"
              onClick={() => setText(phrase)}
              className="rounded-full border border-line bg-white px-3 py-1.5 text-left text-sm text-ink hover:border-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
            >
              {phrase}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void onTranslate()}
          disabled={translating || text.trim().length === 0}
          className="mt-5 flex h-12 w-full items-center justify-center rounded-2xl bg-green px-5 text-base font-semibold text-card hover:bg-green-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green disabled:cursor-not-allowed disabled:opacity-50"
        >
          {translating ? "Translating…" : `Translate to ${target.label}`}
        </button>
        <p className="mt-2 text-center text-sm text-muted">
          Shortcut: Ctrl or Command + Enter
        </p>
      </section>

      <section
        className="rounded-3xl border border-line bg-card p-4 sm:p-6"
        aria-live="polite"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-3xl text-ink">{resultLanguage.label}</h2>
          {providerLabel ? (
            <p className="text-sm text-muted">via {providerLabel}</p>
          ) : null}
        </div>
        <p
          lang={resultLanguage.htmlLang}
          className="mt-3 min-h-24 text-lg leading-relaxed whitespace-pre-wrap"
        >
          {translation || (
            <span className="text-muted">
              The {resultLanguage.description} translation will show up here.
            </span>
          )}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void onSpeak()}
            disabled={!translation || !canPlay || translating}
            className="rounded-full bg-green-ink px-4 py-2 text-sm font-semibold text-card hover:bg-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green disabled:cursor-not-allowed disabled:opacity-40"
          >
            {phase === "speaking" ? "Speaking…" : "Speak"}
          </button>
          <button
            type="button"
            onClick={stopSpeaking}
            disabled={phase !== "speaking"}
            className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green disabled:cursor-not-allowed disabled:opacity-40"
          >
            Stop
          </button>
          <button
            type="button"
            onClick={() => void onCopy()}
            disabled={!translation}
            className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green disabled:cursor-not-allowed disabled:opacity-40"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        {voiceNote ? <p className="mt-3 text-sm text-gold">{voiceNote}</p> : null}
        {error ? (
          <p role="alert" className="mt-3 text-sm text-clay">
            {error}
          </p>
        ) : null}
        {ready && !ready.ready ? (
          <p className="mt-3 text-sm text-clay">
            The server has no translation credential yet. On Vercel, enable AI
            Gateway and deploy without a key. Locally, set AI_GATEWAY_API_KEY,
            OPENAI_API_KEY, or ANTHROPIC_API_KEY in .env.local.
          </p>
        ) : null}
      </section>

      <section className="px-1 text-sm leading-relaxed text-muted">
        <h2 className="font-semibold text-ink">Browser speech</h2>
        <p className="mt-1">
          The microphone uses the Web Speech API in this browser. Chrome and
          Edge can listen. Safari often cannot, Firefox support varies, and iOS
          is the most limited. Pigin does not upload microphone audio. When
          Azure Speech is configured on the server, Speak plays a neural
          Nigerian voice. Otherwise Speak uses this browser, which rarely has a
          Yorùbá voice and has no dedicated Naijá voice. See the README.
        </p>
      </section>
    </div>
  );
}

function haltPlayback(
  audioRef: { current: HTMLAudioElement | null },
  audioUrlRef: { current: string | null },
) {
  if (synthesisSupported()) window.speechSynthesis.cancel();
  const audio = audioRef.current;
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    audioRef.current = null;
  }
  if (audioUrlRef.current) {
    URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
  }
}

function releaseAudioUrl(
  audioUrlRef: { current: string | null },
  url: string,
) {
  URL.revokeObjectURL(url);
  if (audioUrlRef.current === url) audioUrlRef.current = null;
}

function subscribeBrowser() {
  return () => {};
}

function joinTranscript(current: string, transcript: string) {
  const next = transcript.trim();
  if (!current) return next;
  const spacer = /\s$/.test(current) ? "" : " ";
  return `${current}${spacer}${next}`;
}

function recognitionErrorMessage(code: string) {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone permission was blocked. Allow it in the browser, then try again.";
    case "audio-capture":
      return "No microphone was found.";
    case "network":
      return "This browser’s speech recognition needs a network connection.";
    case "language-not-supported":
      return "This browser cannot recognize English speech.";
    default:
      return "Speech recognition stopped unexpectedly.";
  }
}

function MicIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0" strokeLinecap="round" />
      <path d="M12 17v4M8 21h8" strokeLinecap="round" />
    </svg>
  );
}
