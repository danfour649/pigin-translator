"use client";

import { addCatalogItem } from "@/lib/catalog";
import {
  EXAMPLE_PHRASES,
  LANGUAGE_IDS,
  LANGUAGES,
  MAX_SOURCE_LENGTH,
  type LanguageId,
} from "@/lib/languages";
import {
  DEFAULT_TRANSLATION_MODEL_ID,
  isTranslationModelId,
  TRANSLATION_MODELS,
  translationModelById,
  type TranslationModelId,
} from "@/lib/translation-models";
import { SavedCatalog } from "@/components/saved-catalog";
import {
  chooseVoice,
  createRecognition,
  loadVoices,
  recognitionSupported,
  synthesisSupported,
} from "@/lib/speech";
import {
  BROWSER_PLAYBACK_FAILED,
  BROWSER_SPEECH_START_MS,
  IDLE_SESSION,
  PLAYBACK_SESSION,
  SPEAK_WAITING,
  armSpeaker,
  audioSessionOf,
  browserSpeechCard,
  cloudSpeakCard,
  playCloudMp3,
  replayClip,
  setAudioSessionType,
  stopSpeaker,
} from "@/lib/speak-playback";
import {
  CLOUD_AUDIO_MISSING,
  audioFileForSpeak,
  canShareAudioFile,
  downloadAudioFile,
  shareSpokenAudio,
} from "@/lib/spoken-audio";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type Phase = "idle" | "listening" | "translating";
type SpeechVia = "speak" | "replay";

type ReadyState = {
  ready: boolean;
  provider: string | null;
};

type Side = {
  text: string;
  provider: string | null;
  model: string | null;
  error: string | null;
  voiceNote: string | null;
  audioHint: string | null;
  copied: boolean;
};

type SavedCloudAudio = {
  url: string;
  file: File;
  shareable: boolean;
};

type HistoryEntry = {
  id: string;
  english: string;
  modelId: TranslationModelId;
  status: "pending" | "ready";
  sides: Record<LanguageId, Side>;
};

type SpeechTarget = {
  entryId: string;
  language: LanguageId;
  via: SpeechVia;
};

type CloudAudioMap = Record<string, Partial<Record<LanguageId, SavedCloudAudio>>>;

const PROVIDER_LABELS: Record<string, string> = {
  "ai-gateway": "AI Gateway",
  openai: "OpenAI",
  anthropic: "Anthropic",
};

const EMPTY_SIDES: Record<LanguageId, Side> = {
  naija: blankSide(),
  yoruba: blankSide(),
};

export function Translator() {
  const [text, setText] = useState("");
  const [modelId, setModelId] = useState<TranslationModelId>(
    DEFAULT_TRANSLATION_MODEL_ID,
  );
  const [bookmarkNoteId, setBookmarkNoteId] = useState<string | null>(null);
  const [interim, setInterim] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [inputError, setInputError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [speaking, setSpeaking] = useState<SpeechTarget | null>(null);
  const [preparing, setPreparing] = useState<SpeechTarget | null>(null);
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
  const copyTimers = useRef<Record<string, number>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cloudAudioRef = useRef<CloudAudioMap>({});
  const [cloudAudio, setCloudAudio] = useState<CloudAudioMap>({});
  const speakGen = useRef(0);
  const speechWatch = useRef<number | null>(null);
  const inflightFetches = useRef(new Set<string>());
  const historyRef = useRef(history);
  const phaseRef = useRef(phase);
  const voicesRef = useRef(voices);
  const speakStatus = useRef<{
    known: boolean;
    providers: Partial<Record<LanguageId, string | null>>;
  }>({ known: false, providers: {} });
  historyRef.current = history;
  phaseRef.current = phase;
  voicesRef.current = voices;

  useEffect(() => {
    const saved = cloudAudioRef;
    const timers = copyTimers.current;
    return () => {
      recognitionRef.current?.abort();
      speakGen.current += 1;
      clearSpeechWatch(speechWatch);
      haltPlayback(audioRef);
      audioRef.current?.remove();
      audioRef.current = null;
      setAudioSessionType(audioSessionOf(navigator), IDLE_SESSION);
      releaseCloudAudio(saved.current);
      saved.current = {};
      for (const timer of Object.values(timers)) {
        window.clearTimeout(timer);
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

  function updateEntry(entryId: string, language: LanguageId, patch: Partial<Side>) {
    setHistory((current) =>
      current.map((entry) =>
        entry.id === entryId
          ? {
              ...entry,
              sides: {
                ...entry.sides,
                [language]: { ...entry.sides[language], ...patch },
              },
            }
          : entry,
      ),
    );
  }

  function publishCloudAudio(next: CloudAudioMap) {
    cloudAudioRef.current = next;
    setCloudAudio(next);
  }

  function commitCloudAudio(
    entryId: string,
    language: LanguageId,
    file: File,
    url: string,
  ) {
    const previous = cloudAudioRef.current[entryId]?.[language];
    if (previous && previous.url !== url) URL.revokeObjectURL(previous.url);
    publishCloudAudio({
      ...cloudAudioRef.current,
      [entryId]: {
        ...cloudAudioRef.current[entryId],
        [language]: {
          url,
          file,
          shareable: canShareAudioFile(file),
        },
      },
    });
  }

  async function onTranslate() {
    const source = text.trim();
    if (!source || phase === "translating") return;

    stopListening();
    stopSpeaking();
    setInputError(null);
    setBookmarkNoteId(null);
    const id = crypto.randomUUID();
    const entry: HistoryEntry = {
      id,
      english: source,
      modelId,
      status: "pending",
      sides: { naija: blankSide(), yoruba: blankSide() },
    };
    setHistory((current) => [entry, ...current]);
    setOpenIds([]);
    setPhase("translating");

    const outcomes = await Promise.all(
      LANGUAGE_IDS.map(async (language) => {
        try {
          const response = await fetch("/api/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: source, language, model: modelId }),
          });
          const data = (await response.json()) as {
            translation?: string;
            provider?: string;
            model?: string;
            error?: string;
          };
          if (!response.ok || !data.translation) {
            throw new Error(data.error ?? "Translation failed.");
          }
          return {
            language,
            text: data.translation,
            provider: data.provider ?? null,
            model: data.model ?? modelId,
            error: null,
          };
        } catch (translateError) {
          return {
            language,
            text: "",
            provider: null,
            model: null,
            error:
              translateError instanceof Error
                ? translateError.message
                : "Translation failed.",
          };
        }
      }),
    );

    setHistory((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const sides = { ...item.sides };
        for (const outcome of outcomes) {
          sides[outcome.language] = {
            ...sides[outcome.language],
            text: outcome.text,
            provider: outcome.provider,
            model: outcome.model,
            error: outcome.error,
          };
        }
        return { ...item, status: "ready" as const, sides };
      }),
    );
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

  function onBookmark(entryId: string) {
    const entry = historyRef.current.find((item) => item.id === entryId);
    if (!entry || (!entry.sides.naija.text && !entry.sides.yoruba.text)) return;
    const model = translationModelById(entry.modelId);
    addCatalogItem({
      id: crypto.randomUUID(),
      english: entry.english,
      naija: entry.sides.naija.text,
      yoruba: entry.sides.yoruba.text,
      modelId: model.id,
      modelLabel: model.label,
      savedAt: new Date().toISOString(),
      correction: null,
    });
    setBookmarkNoteId(entryId);
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setInterim("");
    setPhase((current) => (current === "listening" ? "idle" : current));
  }

  function toggleOpen(entryId: string) {
    setOpenIds((current) =>
      current.includes(entryId)
        ? current.filter((id) => id !== entryId)
        : [...current, entryId],
    );
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

  async function fetchCloudClip(
    spoken: string,
    spokenLanguage: LanguageId,
    generation: number,
  ): Promise<SavedCloudAudio | null> {
    let playbackUrl: string | null = null;
    let transferred = false;
    try {
      const response = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: spoken, language: spokenLanguage }),
      });
      if (speakGen.current !== generation) return null;
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !contentType.startsWith("audio/")) return null;

      const blob = await response.blob();
      if (speakGen.current !== generation) return null;
      const file = audioFileForSpeak("cloud", spokenLanguage, blob, contentType);
      if (!file) return null;

      playbackUrl = URL.createObjectURL(file);
      if (speakGen.current !== generation) return null;
      transferred = true;
      return {
        url: playbackUrl,
        file,
        shareable: canShareAudioFile(file),
      };
    } catch {
      return null;
    } finally {
      if (playbackUrl && !transferred) URL.revokeObjectURL(playbackUrl);
    }
  }

  async function settleCloud(
    entryId: string,
    spokenLanguage: LanguageId,
    spoken: string,
    generation: number,
    via: SpeechVia,
    existing: SavedCloudAudio | null,
  ): Promise<"settled" | "fallback" | "stale"> {
    const outcome = await replayClip({
      saved: existing,
      fetchClip: () => fetchCloudClip(spoken, spokenLanguage, generation),
      play: (clip) => {
        const active = audioRef.current;
        if (!active || speakGen.current !== generation) return Promise.resolve(false);
        return playCloudMp3(active, clip.url);
      },
    });

    if (speakGen.current !== generation) {
      if (outcome.fetched && outcome.clip) URL.revokeObjectURL(outcome.clip.url);
      return "stale";
    }

    if (!outcome.clip) {
      stopSpeaker(audioRef.current);
      return "fallback";
    }

    const voiceName =
      voicesRef.current[spokenLanguage] ??
      (spokenLanguage === "yoruba" ? "sade" : "en-NG-EzinneNeural");
    const providerLabel = spokenLanguage === "yoruba" ? "Spitch" : "Azure";
    const card = cloudSpeakCard({
      receivedAudio: true,
      playbackStarted: outcome.started,
      providerLabel,
      voiceName,
    });

    if (card.offerFile) {
      commitCloudAudio(entryId, spokenLanguage, outcome.clip.file, outcome.clip.url);
    } else if (outcome.fetched) {
      URL.revokeObjectURL(outcome.clip.url);
    }

    const speaker = audioRef.current;
    setPreparing((current) =>
      matchesSpeech(current, entryId, spokenLanguage) ? null : current,
    );
    setSpeaking(card.speaking ? { entryId, language: spokenLanguage, via } : null);
    if (!card.speaking) {
      setAudioSessionType(audioSessionOf(navigator), IDLE_SESSION);
    }
    updateEntry(entryId, spokenLanguage, {
      voiceNote: card.voiceNote,
      audioHint: card.audioHint,
      error: card.error,
    });

    if (card.speaking && speaker) {
      speaker.onended = () => {
        if (speakGen.current !== generation) return;
        setSpeaking((current) =>
          matchesSpeech(current, entryId, spokenLanguage) ? null : current,
        );
        setAudioSessionType(audioSessionOf(navigator), IDLE_SESSION);
      };
    } else {
      stopSpeaker(speaker);
    }

    return card.useBrowserVoice ? "fallback" : "settled";
  }

  async function speakEntry(
    entryId: string,
    language: LanguageId,
    via: SpeechVia,
  ) {
    const entry = historyRef.current.find((item) => item.id === entryId);
    const spoken = entry?.sides[language].text;
    if (!entry || entry.status !== "ready" || !spoken || phaseRef.current === "translating") {
      return;
    }

    const saved =
      via === "replay" ? (cloudAudioRef.current[entryId]?.[language] ?? null) : null;
    const fetchKey = `${entryId}:${language}`;
    if (!saved && via === "replay" && inflightFetches.current.has(fetchKey)) return;

    const generation = ++speakGen.current;
    clearSpeechWatch(speechWatch);
    haltPlayback(audioRef);
    setSpeaking(null);
    setPreparing(null);

    const speaker = audioRef.current ?? document.createElement("audio");
    audioRef.current = speaker;
    // Arm before any await so iOS still treats the later MP3 as this click.
    armSpeaker(speaker, document.body);

    if (saved) {
      updateEntry(entryId, language, {
        voiceNote: null,
        error: null,
        audioHint: null,
      });
      await settleCloud(entryId, language, spoken, generation, via, saved);
      return;
    }

    if (via === "replay") inflightFetches.current.add(fetchKey);
    try {
      await speakFromProvider(entryId, language, spoken, generation, via);
    } finally {
      if (via === "replay") inflightFetches.current.delete(fetchKey);
    }
  }

  async function speakFromProvider(
    entryId: string,
    language: LanguageId,
    spoken: string,
    generation: number,
    via: SpeechVia,
  ) {
    setPreparing({ entryId, language, via });
    updateEntry(entryId, language, {
      voiceNote: null,
      error: null,
      audioHint: SPEAK_WAITING,
    });

    const knownProviders = speakStatus.current.known
      ? speakStatus.current.providers
      : await loadSpeakStatus();
    if (speakGen.current !== generation) return;

    const useCloud = Boolean(knownProviders[language]);
    if (!useCloud && !canSpeak) {
      stopSpeaker(audioRef.current);
      setPreparing((current) =>
        matchesSpeech(current, entryId, language) ? null : current,
      );
      updateEntry(entryId, language, {
        voiceNote: BROWSER_PLAYBACK_FAILED,
        audioHint: null,
      });
      return;
    }

    if (useCloud) {
      const outcome = await settleCloud(
        entryId,
        language,
        spoken,
        generation,
        via,
        null,
      );
      if (outcome !== "fallback" || speakGen.current !== generation) return;
      updateEntry(entryId, language, { audioHint: CLOUD_AUDIO_MISSING });
    }

    if (!canSpeak) {
      stopSpeaker(audioRef.current);
      setPreparing((current) =>
        matchesSpeech(current, entryId, language) ? null : current,
      );
      updateEntry(entryId, language, {
        voiceNote: BROWSER_PLAYBACK_FAILED,
        audioHint: useCloud ? CLOUD_AUDIO_MISSING : null,
      });
      return;
    }

    await speakWithBrowser(entryId, spoken, language, generation, via);
  }

  async function speakWithBrowser(
    entryId: string,
    spoken: string,
    spokenLanguage: LanguageId,
    generation: number,
    via: SpeechVia,
  ) {
    if (!synthesisSupported() || speakGen.current !== generation) return;

    stopSpeaker(audioRef.current);
    window.speechSynthesis.cancel();
    const available = await loadVoices();
    if (speakGen.current !== generation) return;

    setAudioSessionType(audioSessionOf(navigator), PLAYBACK_SESSION);
    const choice = chooseVoice(spokenLanguage, available);
    const utterance = new SpeechSynthesisUtterance(spoken);
    if (choice.voice) {
      utterance.voice = choice.voice;
      utterance.lang = choice.voice.lang;
    } else {
      utterance.lang = spokenLanguage === "yoruba" ? "yo-NG" : "en-NG";
    }
    utterance.rate = 0.95;

    let speechPhase: "wait" | "started" | "failed" = "wait";
    const apply = (event: "start" | "end" | "error" | "timeout") => {
      if (speakGen.current !== generation || speechPhase === "failed") return;
      if (event === "timeout" && speechPhase === "started") return;
      if (event === "end" && speechPhase !== "started") return;
      if (event === "start" && speechPhase !== "wait") return;

      const card = browserSpeechCard(event, choice.note);
      if (event === "start") speechPhase = "started";
      if (event === "error" || event === "timeout") {
        speechPhase = "failed";
        clearSpeechWatch(speechWatch);
        if (event === "timeout") window.speechSynthesis.cancel();
      }
      if (event === "end" || event === "start") clearSpeechWatch(speechWatch);

      setPreparing((current) =>
        matchesSpeech(current, entryId, spokenLanguage) ? null : current,
      );
      setSpeaking(
        card.speaking ? { entryId, language: spokenLanguage, via } : null,
      );
      setHistory((current) =>
        current.map((item) => {
          if (item.id !== entryId) return item;
          const side = item.sides[spokenLanguage];
          return {
            ...item,
            sides: {
              ...item.sides,
              [spokenLanguage]: {
                ...side,
                voiceNote: card.voiceNote,
                error: card.error,
                audioHint: side.audioHint === SPEAK_WAITING ? null : side.audioHint,
              },
            },
          };
        }),
      );
      if (!card.speaking) {
        setAudioSessionType(audioSessionOf(navigator), IDLE_SESSION);
      }
    };

    utterance.onstart = () => apply("start");
    utterance.onend = () => apply("end");
    utterance.onerror = () => apply("error");
    clearSpeechWatch(speechWatch);
    speechWatch.current = window.setTimeout(
      () => apply("timeout"),
      BROWSER_SPEECH_START_MS,
    );
    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    speakGen.current += 1;
    clearSpeechWatch(speechWatch);
    haltPlayback(audioRef);
    setAudioSessionType(audioSessionOf(navigator), IDLE_SESSION);
    setSpeaking(null);
    setPreparing(null);
  }

  function onDownloadAudio(entryId: string, language: LanguageId) {
    const saved = cloudAudioRef.current[entryId]?.[language];
    if (!saved) return;
    downloadAudioFile(saved.url, saved.file.name);
  }

  async function onShareAudio(entryId: string, language: LanguageId) {
    const saved = cloudAudioRef.current[entryId]?.[language];
    if (!saved) return;
    const result = await shareSpokenAudio(saved.file);
    if (result === "unavailable") downloadAudioFile(saved.url, saved.file.name);
  }

  async function onCopy(entryId: string, language: LanguageId) {
    const value = historyRef.current.find((item) => item.id === entryId)?.sides[
      language
    ].text;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      updateEntry(entryId, language, { copied: true });
      const key = `${entryId}:${language}`;
      const existing = copyTimers.current[key];
      if (existing) window.clearTimeout(existing);
      copyTimers.current[key] = window.setTimeout(() => {
        updateEntry(entryId, language, { copied: false });
      }, 2000);
    } catch {
      updateEntry(entryId, language, {
        error: "Copying was blocked by the browser.",
      });
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

        <div className="mt-5">
          <label htmlFor="translation-model" className="text-sm font-semibold">
            Translation model
          </label>
          <select
            id="translation-model"
            name="translation-model"
            value={modelId}
            onChange={(event) => {
              const next = event.target.value;
              if (isTranslationModelId(next)) setModelId(next);
            }}
            className="mt-2 h-12 w-full rounded-2xl border border-line bg-white px-3 text-sm text-ink hover:border-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
          >
            {TRANSLATION_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-sm text-muted">
            {translationModelById(modelId).note}{" "}
            <span className="font-mono text-xs">{modelId}</span>
          </p>
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

      {history.length === 0 ? (
        <>
          <LanguageCards
            entryId={null}
            status="placeholder"
            sides={EMPTY_SIDES}
            clips={{}}
            speaking={speaking}
            preparing={preparing}
            canSpeak={canSpeak}
            providers={providers}
            translating={translating}
            showReplay={false}
            live
            onSpeak={() => {}}
            onReplay={() => {}}
            onStop={stopSpeaking}
            onCopy={() => {}}
            onDownload={() => {}}
            onShare={() => {}}
          />
          <BookmarkControl
            disabled
            noted={false}
            onBookmark={() => {}}
          />
        </>
      ) : (
        <ol className="flex flex-col gap-4" aria-label="Translations">
          {history.map((entry, index) => {
            const expanded = index === 0 || openIds.includes(entry.id);
            const speechActive =
              speaking?.entryId === entry.id || preparing?.entryId === entry.id;
            return expanded ? (
              <li
                key={entry.id}
                id={`translation-${entry.id}`}
                className="flex flex-col gap-5"
              >
                <div className="flex items-start justify-between gap-3 px-1">
                  <p className="min-w-0 text-sm leading-relaxed">
                    <span className="font-semibold text-ink">English</span>
                    <span className="mt-1 block text-base whitespace-pre-wrap text-ink">
                      {entry.english}
                    </span>
                  </p>
                  {index === 0 ? null : (
                    <button
                      type="button"
                      onClick={() => toggleOpen(entry.id)}
                      aria-expanded={true}
                      className="shrink-0 rounded-full border border-line bg-card px-3 py-1.5 text-sm font-semibold hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
                    >
                      Show less
                    </button>
                  )}
                </div>
                <LanguageCards
                  entryId={entry.id}
                  status={entry.status}
                  sides={entry.sides}
                  clips={cloudAudio[entry.id] ?? {}}
                  speaking={speaking}
                  preparing={preparing}
                  canSpeak={canSpeak}
                  providers={providers}
                  translating={translating}
                  showReplay
                  live={index === 0}
                  onSpeak={(language) => void speakEntry(entry.id, language, "speak")}
                  onReplay={(language) => void speakEntry(entry.id, language, "replay")}
                  onStop={stopSpeaking}
                  onCopy={(language) => void onCopy(entry.id, language)}
                  onDownload={(language) => onDownloadAudio(entry.id, language)}
                  onShare={(language) => void onShareAudio(entry.id, language)}
                />
                <BookmarkControl
                  disabled={
                    entry.status !== "ready" ||
                    (!entry.sides.naija.text && !entry.sides.yoruba.text)
                  }
                  noted={bookmarkNoteId === entry.id}
                  onBookmark={() => onBookmark(entry.id)}
                />
              </li>
            ) : (
              <CompactHistoryRow
                key={entry.id}
                entry={entry}
                speechActive={speechActive}
                onOpen={toggleOpen}
                onStop={stopSpeaking}
              />
            );
          })}
        </ol>
      )}

      <SavedCatalog />

      <section className="px-1 text-sm leading-relaxed text-muted">
        <h2 className="font-semibold text-ink">Browser speech</h2>
        <p className="mt-1">
          The microphone uses the Web Speech API in this browser. Chrome and
          Edge can listen. Safari often cannot, Firefox support varies, and iOS
          is the most limited. Pigin does not upload microphone audio. When
          Spitch is configured, Yorùbá Speak plays that voice. When Azure
          Speech is configured, Naijá Speak plays that voice. After that voice
          plays, Replay plays that recording again without requesting another
          one. If it has not been fetched yet, Replay fetches it once and then
          keeps it. Download or share can attach the MP3 in WhatsApp or
          Messages. If Speak uses this browser instead, there is no audio
          file. This browser
          rarely has a Yorùbá voice and has no dedicated Naijá voice. See the
          README.
        </p>
      </section>
    </div>
  );
}

function LanguageCards({
  entryId,
  status,
  sides,
  clips,
  speaking,
  preparing,
  canSpeak,
  providers,
  translating,
  showReplay,
  live,
  onSpeak,
  onReplay,
  onStop,
  onCopy,
  onDownload,
  onShare,
}: {
  entryId: string | null;
  status: "placeholder" | "pending" | "ready";
  sides: Record<LanguageId, Side>;
  clips: Partial<Record<LanguageId, SavedCloudAudio>>;
  speaking: SpeechTarget | null;
  preparing: SpeechTarget | null;
  canSpeak: boolean;
  providers: Partial<Record<LanguageId, string | null>>;
  translating: boolean;
  showReplay: boolean;
  live: boolean;
  onSpeak: (language: LanguageId) => void;
  onReplay: (language: LanguageId) => void;
  onStop: () => void;
  onCopy: (language: LanguageId) => void;
  onDownload: (language: LanguageId) => void;
  onShare: (language: LanguageId) => void;
}) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {LANGUAGE_IDS.map((language) => {
        const item = LANGUAGES[language];
        const side = sides[language];
        const providerLabel = side.provider
          ? (PROVIDER_LABELS[side.provider] ?? side.provider)
          : null;
        const modelLabel =
          side.model && isTranslationModelId(side.model)
            ? translationModelById(side.model).label
            : side.model;
        const thisSpeaking = matchesSpeech(speaking, entryId, language);
        const thisPreparing = matchesSpeech(preparing, entryId, language);
        const canPlay = canSpeak || Boolean(providers[language]);
        const saved = clips[language];
        const canReplay = Boolean(saved) || canPlay;
        const speakLabel = thisSpeaking && speaking?.via === "speak";
        const replayLabel = thisSpeaking && speaking?.via === "replay";
        return (
          <section
            key={language}
            className="rounded-3xl border border-line bg-card p-4 sm:p-6"
            aria-live={live ? "polite" : undefined}
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-3xl text-ink">{item.label}</h2>
              {providerLabel ? (
                <p className="text-right text-sm text-muted">
                  via {providerLabel}
                  {modelLabel ? ` · ${modelLabel}` : ""}
                </p>
              ) : null}
            </div>
            <p
              lang={item.htmlLang}
              className="mt-3 min-h-24 text-lg leading-relaxed whitespace-pre-wrap"
            >
              {side.text ? (
                side.text
              ) : (
                <span className="text-muted">
                  {status === "pending"
                    ? "Translating…"
                    : `The ${item.description} translation will show up here.`}
                </span>
              )}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onSpeak(language)}
                disabled={!side.text || !canPlay || translating || thisPreparing}
                aria-busy={thisPreparing && preparing?.via === "speak"}
                aria-label={`Speak ${item.label}`}
                className="rounded-full bg-green-ink px-4 py-2 text-sm font-semibold text-card hover:bg-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green disabled:cursor-not-allowed disabled:opacity-40"
              >
                {speakLabel ? "Speaking…" : "Speak"}
              </button>
              {showReplay ? (
                <button
                  type="button"
                  onClick={() => onReplay(language)}
                  disabled={!side.text || !canReplay || translating || thisPreparing}
                  aria-busy={thisPreparing && preparing?.via === "replay"}
                  aria-label={`Replay ${item.label}`}
                  className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {replayLabel ? "Replaying…" : "Replay"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onStop}
                disabled={!thisSpeaking && !thisPreparing}
                aria-label={`Stop ${item.label}`}
                className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green disabled:cursor-not-allowed disabled:opacity-40"
              >
                Stop
              </button>
              <button
                type="button"
                onClick={() => onCopy(language)}
                disabled={!side.text}
                aria-label={`Copy ${item.label}`}
                className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green disabled:cursor-not-allowed disabled:opacity-40"
              >
                {side.copied ? "Copied" : "Copy"}
              </button>
              {saved ? (
                <button
                  type="button"
                  onClick={() => onDownload(language)}
                  aria-label={`Download ${item.label} audio`}
                  title="Download an MP3 you can attach in WhatsApp or Messages"
                  className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
                >
                  Download
                </button>
              ) : null}
              {saved?.shareable ? (
                <button
                  type="button"
                  onClick={() => onShare(language)}
                  aria-label={`Share ${item.label} audio`}
                  title="Open the share sheet to attach this MP3"
                  className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
                >
                  Share
                </button>
              ) : null}
            </div>
            {saved ? (
              <p className="mt-3 text-sm text-muted">
                This MP3 can be attached in WhatsApp or Messages.
              </p>
            ) : null}
            {side.voiceNote ? (
              <p className="mt-3 text-sm text-gold">{side.voiceNote}</p>
            ) : null}
            {side.audioHint ? (
              <p className="mt-2 text-sm text-muted">{side.audioHint}</p>
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
  );
}

function CompactHistoryRow({
  entry,
  speechActive,
  onOpen,
  onStop,
}: {
  entry: HistoryEntry;
  speechActive: boolean;
  onOpen: (id: string) => void;
  onStop: () => void;
}) {
  const detail =
    entry.status === "pending"
      ? "Translating…"
      : `Naijá: ${sidePreview(entry.sides.naija)} · Yorùbá: ${sidePreview(entry.sides.yoruba)}`;
  return (
    <li id={`translation-${entry.id}`} className="flex items-stretch gap-2">
      <button
        type="button"
        aria-expanded={false}
        onClick={() => onOpen(entry.id)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-line bg-card px-3 py-2 text-left hover:border-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">
            {oneLine(entry.english)}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted">{detail}</span>
        </span>
        <span className="shrink-0 text-sm font-semibold text-green-ink">Open</span>
      </button>
      {speechActive ? (
        <button
          type="button"
          onClick={onStop}
          className="shrink-0 rounded-2xl border border-line bg-card px-3 text-sm font-semibold hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
        >
          Stop
        </button>
      ) : null}
    </li>
  );
}

function BookmarkControl({
  disabled,
  noted,
  onBookmark,
}: {
  disabled: boolean;
  noted: boolean;
  onBookmark: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={onBookmark}
        disabled={disabled}
        className="rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green disabled:cursor-not-allowed disabled:opacity-40"
      >
        Bookmark this translation
      </button>
      {noted ? (
        <p aria-live="polite" className="text-sm text-green-ink">
          Saved in this browser.
        </p>
      ) : null}
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
    model: null,
    error: null,
    voiceNote: null,
    audioHint: null,
    copied: false,
  };
}

function matchesSpeech(
  current: SpeechTarget | null,
  entryId: string | null,
  language: LanguageId,
) {
  return current?.entryId === entryId && current.language === language;
}

function oneLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function sidePreview(side: Side) {
  if (side.text) return oneLine(side.text);
  if (side.error) return oneLine(side.error);
  return "…";
}

function haltPlayback(audioRef: { current: HTMLAudioElement | null }) {
  if (synthesisSupported()) window.speechSynthesis.cancel();
  stopSpeaker(audioRef.current);
}

function clearSpeechWatch(watch: { current: number | null }) {
  if (watch.current == null) return;
  window.clearTimeout(watch.current);
  watch.current = null;
}

function releaseCloudAudio(saved: CloudAudioMap) {
  for (const entry of Object.values(saved)) {
    for (const clip of Object.values(entry)) {
      if (clip) URL.revokeObjectURL(clip.url);
    }
  }
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
