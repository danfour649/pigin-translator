"use client";

import {
  EXAMPLE_PHRASES,
  LANGUAGE_IDS,
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

type Phase = "idle" | "listening" | "translating";

type ReadyState = {
  ready: boolean;
  provider: string | null;
};

type Side = {
  text: string;
  provider: string | null;
  error: string | null;
  voiceNote: string | null;
  copied: boolean;
};

const PROVIDER_LABELS: Record<string, string> = {
  "ai-gateway": "AI Gateway",
  openai: "OpenAI",
  anthropic: "Anthropic",
};

export function Translator() {
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [sides, setSides] = useState<Record<LanguageId, Side>>({
    naija: blankSide(),
    yoruba: blankSide(),
  });
  const [inputError, setInputError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [speaking, setSpeaking] = useState<LanguageId | null>(null);
  const [ready, setReady] = useState<ReadyState | null>(null);
  const [voices, setVoices] = useState<Partial<Record<LanguageId, string>>>({});
  const [providers, setProviders] = useState<
    Partial<Record<LanguageId, string | null>>
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
  const copyTimers = useRef<Partial<Record<LanguageId, number>>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const speakGen = useRef(0);
  const speakStatus = useRef<{
    known: boolean;
    providers: Partial<Record<LanguageId, string | null>>;
  }>({ known: false, providers: {} });

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      speakGen.current += 1;
      haltPlayback(audioRef, audioUrlRef);
      for (const timer of Object.values(copyTimers.current)) {
        if (timer) window.clearTimeout(timer);
      }
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
          providers?: Partial<Record<LanguageId, string | null>>;
          voices?: Partial<Record<LanguageId, string>>;
        };
      })
      .then((data) => {
        const nextProviders = data.providers ?? {};
        speakStatus.current = { known: true, providers: nextProviders };
        setProviders(nextProviders);
        setVoices(data.voices ?? {});
      })
      .catch((fetchError: unknown) => {
        if (
          fetchError instanceof DOMException &&
          fetchError.name === "AbortError"
        ) {
          return;
        }
        speakStatus.current = { known: true, providers: {} };
        setProviders({});
      });

    return () => controller.abort();
  }, []);

  function updateSide(language: LanguageId, patch: Partial<Side>) {
    setSides((current) => ({
      ...current,
      [language]: { ...current[language], ...patch },
    }));
  }

  async function onTranslate() {
    const source = text.trim();
    if (!source || phase === "translating") return;

    stopListening();
    stopSpeaking();
    for (const timer of Object.values(copyTimers.current)) {
      if (timer) window.clearTimeout(timer);
    }
    copyTimers.current = {};
    setInputError(null);
    setSides({ naija: blankSide(), yoruba: blankSide() });
    setPhase("translating");

    const outcomes = await Promise.all(
      LANGUAGE_IDS.map(async (language) => {
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
          return {
            language,
            text: data.translation,
            provider: data.provider ?? null,
            error: null,
          };
        } catch (translateError) {
          return {
            language,
            text: "",
            provider: null,
            error:
              translateError instanceof Error
                ? translateError.message
                : "Translation failed.",
          };
        }
      }),
    );

    setSides((current) => {
      const next = { ...current };
      for (const outcome of outcomes) {
        next[outcome.language] = {
          ...current[outcome.language],
          text: outcome.text,
          provider: outcome.provider,
          error: outcome.error,
        };
      }
      return next;
    });
    setPhase("idle");
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
    setInputError(null);
    setInterim("");
    bindRecognition(recognition, {
      onResult: (event) => {
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
      },
      onError: (event) => {
        if (event.error === "aborted" || event.error === "no-speech") return;
        setInputError(recognitionErrorMessage(event.error));
        setPhase("idle");
      },
      onEnd: () => {
        setInterim("");
        setPhase((current) => (current === "listening" ? "idle" : current));
      },
    });

    try {
      recognition.start();
      setPhase("listening");
    } catch {
      setInputError("The microphone is already in use. Stop it, then try again.");
    }
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setInterim("");
    setPhase((current) => (current === "listening" ? "idle" : current));
  }

  async function loadSpeakStatus() {
    try {
      const response = await fetch("/api/speak");
      if (!response.ok) throw new Error("Speech status check failed");
      const data = (await response.json()) as {
        providers?: Partial<Record<LanguageId, string | null>>;
        voices?: Partial<Record<LanguageId, string>>;
      };
      const nextProviders = data.providers ?? {};
      speakStatus.current = { known: true, providers: nextProviders };
      setProviders(nextProviders);
      setVoices(data.voices ?? {});
      return nextProviders;
    } catch {
      speakStatus.current = { known: true, providers: {} };
      setProviders({});
      return {};
    }
  }

  async function onSpeak(language: LanguageId) {
    const spoken = sides[language].text;
    if (!spoken || phase === "translating") return;

    const generation = ++speakGen.current;
    haltPlayback(audioRef, audioUrlRef);
    setSpeaking(language);
    updateSide(language, { voiceNote: null, error: null });

    const knownProviders = speakStatus.current.known
      ? speakStatus.current.providers
      : await loadSpeakStatus();
    if (speakGen.current !== generation) return;

    const useCloud = Boolean(knownProviders[language]);
    if (!useCloud && !canSpeak) {
      setSpeaking((current) => (current === language ? null : current));
      updateSide(language, {
        voiceNote: "This browser could not play the translation.",
      });
      return;
    }

    if (useCloud) {
      const played = await speakWithCloud(spoken, language, generation);
      if (played || speakGen.current !== generation) return;
    }

    if (!canSpeak) {
      setSpeaking((current) => (current === language ? null : current));
      updateSide(language, {
        voiceNote: "This browser could not play the translation.",
      });
      return;
    }

    await speakWithBrowser(spoken, language, generation);
  }

  async function speakWithCloud(
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
        voices[spokenLanguage] ??
        (spokenLanguage === "yoruba" ? "sade" : "en-NG-EzinneNeural");
      const providerLabel = spokenLanguage === "yoruba" ? "Spitch" : "Azure";
      updateSide(spokenLanguage, {
        voiceNote: `Speaking with ${providerLabel} ${voiceName}.`,
      });
      audio.onended = () => {
        if (speakGen.current !== generation) return;
        setSpeaking((current) => (current === spokenLanguage ? null : current));
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
    const available = await loadVoices();
    if (speakGen.current !== generation) return;

    const choice = chooseVoice(spokenLanguage, available);
    const utterance = new SpeechSynthesisUtterance(spoken);
    if (choice.voice) {
      utterance.voice = choice.voice;
      utterance.lang = choice.voice.lang;
    } else {
      utterance.lang = spokenLanguage === "yoruba" ? "yo-NG" : "en-NG";
    }
    utterance.rate = 0.95;
    utterance.onend = () => {
      if (speakGen.current === generation) {
        setSpeaking((current) => (current === spokenLanguage ? null : current));
      }
    };
    utterance.onerror = () => {
      if (speakGen.current !== generation) return;
      setSpeaking((current) => (current === spokenLanguage ? null : current));
      updateSide(spokenLanguage, {
        voiceNote: "This browser could not play the translation.",
      });
    };

    updateSide(spokenLanguage, { voiceNote: choice.note });
    setSpeaking(spokenLanguage);
    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    speakGen.current += 1;
    haltPlayback(audioRef, audioUrlRef);
    setSpeaking(null);
  }

  async function onCopy(language: LanguageId) {
    const value = sides[language].text;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      updateSide(language, { copied: true });
      const existing = copyTimers.current[language];
      if (existing) window.clearTimeout(existing);
      copyTimers.current[language] = window.setTimeout(() => {
        updateSide(language, { copied: false });
      }, 2000);
    } catch {
      updateSide(language, { error: "Copying was blocked by the browser." });
    }
  }

  const listening = phase === "listening";
  const translating = phase === "translating";

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-3xl border border-line bg-card p-4 shadow-[0_18px_50px_rgb(28_22_18_/_0.06)] sm:p-6">
        <label htmlFor="english" className="block text-sm font-semibold">
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
                ? "The microphone listens for English and fills both translations."
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
          {translating ? "Translating…" : "Translate"}
        </button>
        <p className="mt-2 text-center text-sm text-muted">
          Shortcut: Ctrl or Command + Enter
        </p>
        {inputError ? (
          <p role="alert" className="mt-3 text-sm text-clay">
            {inputError}
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

      <div className="grid gap-5 md:grid-cols-2">
        {LANGUAGE_IDS.map((language) => {
          const item = LANGUAGES[language];
          const side = sides[language];
          const providerLabel = side.provider
            ? (PROVIDER_LABELS[side.provider] ?? side.provider)
            : null;
          const thisSpeaking = speaking === language;
          const canPlay = canSpeak || Boolean(providers[language]);
          return (
            <section
              key={language}
              className="rounded-3xl border border-line bg-card p-4 sm:p-6"
              aria-live="polite"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-display text-3xl text-ink">{item.label}</h2>
                {providerLabel ? (
                  <p className="text-sm text-muted">via {providerLabel}</p>
                ) : null}
              </div>
              <p
                lang={item.htmlLang}
                className="mt-3 min-h-24 text-lg leading-relaxed whitespace-pre-wrap"
              >
                {side.text || (
                  <span className="text-muted">
                    The {item.description} translation will show up here.
                  </span>
                )}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void onSpeak(language)}
                  disabled={!side.text || !canPlay || translating}
                  aria-label={`Speak ${item.label}`}
                  className="rounded-full bg-green-ink px-4 py-2 text-sm font-semibold text-card hover:bg-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {thisSpeaking ? "Speaking…" : "Speak"}
                </button>
                <button
                  type="button"
                  onClick={stopSpeaking}
                  disabled={!thisSpeaking}
                  aria-label={`Stop ${item.label}`}
                  className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Stop
                </button>
                <button
                  type="button"
                  onClick={() => void onCopy(language)}
                  disabled={!side.text}
                  aria-label={`Copy ${item.label}`}
                  className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {side.copied ? "Copied" : "Copy"}
                </button>
              </div>
              {side.voiceNote ? (
                <p className="mt-3 text-sm text-gold">{side.voiceNote}</p>
              ) : null}
              {side.error ? (
                <p role="alert" className="mt-3 text-sm text-clay">
                  {side.error}
                </p>
              ) : null}
            </section>
          );
        })}
      </div>

      <section className="px-1 text-sm leading-relaxed text-muted">
        <h2 className="font-semibold text-ink">Browser speech</h2>
        <p className="mt-1">
          The microphone uses the Web Speech API in this browser. Chrome and
          Edge can listen. Safari often cannot, Firefox support varies, and iOS
          is the most limited. Pigin does not upload microphone audio. When
          Spitch is configured, Yorùbá Speak plays that voice. When Azure
          Speech is configured, Naijá Speak plays that voice. Otherwise that
          side uses this browser, which rarely has a Yorùbá voice and has no
          dedicated Naijá voice. See the README.
        </p>
      </section>
    </div>
  );
}

function bindRecognition(
  recognition: SpeechRecognition,
  handlers: {
    onResult: (event: SpeechRecognitionEvent) => void;
    onError: (event: SpeechRecognitionErrorEvent) => void;
    onEnd: () => void;
  },
) {
  recognition.onresult = handlers.onResult;
  recognition.onerror = handlers.onError;
  recognition.onend = handlers.onEnd;
}

function blankSide(): Side {
  return {
    text: "",
    provider: null,
    error: null,
    voiceNote: null,
    copied: false,
  };
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
