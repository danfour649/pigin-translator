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
  PLAYBACK_SPEEDS,
  type PlaybackSpeed,
  applyPlaybackSpeed,
  playClipToEnd,
  playCloudMp3,
  replayClip,
  splitWords,
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
import { getCachedSpeakClip, storeSpeakClip } from "@/lib/speak-cache";
import {
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

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
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const [learnTarget, setLearnTarget] = useState<{
    entryId: string;
    language: LanguageId;
  } | null>(null);
  const [learnWord, setLearnWord] = useState<{
    entryId: string;
    language: LanguageId;
    index: number;
  } | null>(null);
  const [learnLoop, setLearnLoop] = useState(false);
  const learnGen = useRef(0);
  const learnLoopRef = useRef(false);
  learnLoopRef.current = learnLoop;
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
      // A clip for this exact text may already sit in the browser cache.
      // It plays (and saves) like a fresh cloud success, with no provider
      // call and no speak-guard spend.
      const voice = voicesRef.current[spokenLanguage] ?? null;
      const cached = await getCachedSpeakClip(spokenLanguage, voice, spoken);
      if (speakGen.current !== generation) return null;
      if (cached) {
        const cachedFile = audioFileForSpeak(
          "cloud",
          spokenLanguage,
          cached.blob,
          cached.contentType,
        );
        if (cachedFile) {
          playbackUrl = URL.createObjectURL(cachedFile);
          if (speakGen.current !== generation) return null;
          transferred = true;
          return {
            url: playbackUrl,
            file: cachedFile,
            shareable: canShareAudioFile(cachedFile),
          };
        }
      }

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

      // Keep the clip so the next Speak or Replay of this exact text is
      // served from the browser cache instead of the provider. Only real
      // provider audio reaches this line; errors and fallbacks never do.
      void storeSpeakClip(spokenLanguage, voice, spoken, { blob, contentType });

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
        return playCloudMp3(active, clip.url, undefined, playbackSpeed);
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

    // Label the card from the provider the status check actually reported
    // for this language (Naijá is Spitch-first now, Azure only as its
    // dormant fallback), not from the language alone.
    const providerName = speakStatus.current.providers[spokenLanguage];
    const isAzure = providerName === "azure";
    const providerLabel = isAzure ? "Azure" : "Spitch";
    const voiceName =
      voicesRef.current[spokenLanguage] ??
      (spokenLanguage === "yoruba"
        ? "sade"
        : isAzure
          ? "en-NG-EzinneNeural"
          : "tayo");
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
    utterance.rate = 0.95 * playbackSpeed;

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
    learnGen.current += 1;
    setLearnWord(null);
    clearSpeechWatch(speechWatch);
    haltPlayback(audioRef);
    setAudioSessionType(audioSessionOf(navigator), IDLE_SESSION);
    setSpeaking(null);
    setPreparing(null);
  }

  function ensureSpeaker(): HTMLAudioElement {
    const speaker = audioRef.current ?? document.createElement("audio");
    audioRef.current = speaker;
    if (!speaker.parentNode) armSpeaker(speaker, document.body);
    return speaker;
  }

  /** Load a saved clip into the shared element and play it, at the chosen speed. */
  function loadAndPlayClip(url: string) {
    const speaker = ensureSpeaker();
    speaker.loop = learnLoopRef.current;
    if (speaker.src !== url) {
      speaker.pause();
      speaker.src = url;
    }
    applyPlaybackSpeed(speaker, playbackSpeed);
    void speaker.play().catch(() => {});
  }

  function onLearn(entryId: string, language: LanguageId) {
    if (learnTarget?.entryId === entryId && learnTarget?.language === language) {
      stopSpeaking();
      setLearnTarget(null);
      return;
    }
    setLearnTarget({ entryId, language });
    const saved = cloudAudioRef.current[entryId]?.[language];
    if (saved) {
      stopSpeaking();
      setLearnTarget({ entryId, language });
      loadAndPlayClip(saved.url);
    } else {
      void speakEntry(entryId, language, "speak");
    }
  }

  /**
   * Learn mode, word by word: speak each word of the translation on its
   * own, with a real pause between words, highlighting the word being
   * spoken. Word clips come through the same cache-first fetch as whole
   * sentences, so repeats cost no provider call. The gap widens as the
   * chosen speed slows. Loop repeats the whole sentence until stopped.
   */
  async function learnWords(entryId: string, language: LanguageId) {
    const entry = historyRef.current.find((item) => item.id === entryId);
    const text = entry?.sides[language].text;
    if (!entry || entry.status !== "ready" || !text) return;
    const words = splitWords(text);
    if (words.length === 0) return;

    stopSpeaking();
    setLearnTarget({ entryId, language });
    const generation = speakGen.current;
    const token = ++learnGen.current;
    const speaker = ensureSpeaker();
    const gapMs = Math.round(650 / playbackSpeed);
    const cancelled = () =>
      learnGen.current !== token || speakGen.current !== generation;

    try {
      do {
        for (let index = 0; index < words.length; index += 1) {
          if (cancelled()) return;
          const clip = await fetchCloudClip(words[index], language, generation);
          if (!clip || cancelled()) return;
          setLearnWord({ entryId, language, index });
          const played = await playClipToEnd(speaker, clip.url, playbackSpeed);
          URL.revokeObjectURL(clip.url);
          if (!played || cancelled()) return;
          if (index < words.length - 1 || learnLoopRef.current) {
            await new Promise((resolve) => window.setTimeout(resolve, gapMs));
          }
        }
      } while (learnLoopRef.current && !cancelled());
    } finally {
      if (!cancelled()) setLearnWord(null);
    }
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

        <div className="mt-5">
          <span id="speech-speed-label" className="text-sm font-semibold">
            Speech speed
          </span>
          <div
            role="group"
            aria-labelledby="speech-speed-label"
            className="mt-2 flex gap-2"
          >
            {PLAYBACK_SPEEDS.map((speed) => (
              <button
                key={speed}
                type="button"
                aria-pressed={playbackSpeed === speed}
                onClick={() => {
                  setPlaybackSpeed(speed);
                  const active = audioRef.current;
                  if (active && !active.paused) {
                    applyPlaybackSpeed(active, speed);
                  }
                }}
                className={
                  playbackSpeed === speed
                    ? "h-10 flex-1 rounded-full border border-green bg-green px-3 text-sm font-semibold text-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
                    : "h-10 flex-1 rounded-full border border-line bg-white px-3 text-sm text-ink hover:border-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
                }
              >
                {speed}×
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-sm text-muted">
            Slower speeds make the pronunciation easier to hear. Applies to
            Speak and Replay.
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
            learnTarget={null}
            learnWord={null}
            learnLoop={false}
            getSpeaker={() => audioRef.current}
            onLoadClip={loadAndPlayClip}
            onLearn={() => {}}
            onLearnWords={() => {}}
            onLoopChange={setLearnLoop}
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
                  learnTarget={learnTarget}
                  learnWord={learnWord}
                  learnLoop={learnLoop}
                  getSpeaker={() => audioRef.current}
                  onLoadClip={loadAndPlayClip}
                  onLearn={(language) => onLearn(entry.id, language)}
                  onLearnWords={(language) => void learnWords(entry.id, language)}
                  onLoopChange={setLearnLoop}
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
  learnTarget,
  learnWord,
  learnLoop,
  getSpeaker,
  onLoadClip,
  onLearn,
  onLearnWords,
  onLoopChange,
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
  learnTarget: { entryId: string; language: LanguageId } | null;
  learnWord: { entryId: string; language: LanguageId; index: number } | null;
  learnLoop: boolean;
  getSpeaker: () => HTMLAudioElement | null;
  onLoadClip: (url: string) => void;
  onLearn: (language: LanguageId) => void;
  onLearnWords: (language: LanguageId) => void;
  onLoopChange: (loop: boolean) => void;
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
        const learnOpen =
          learnTarget?.entryId === entryId && learnTarget?.language === language;
        const activeWord =
          learnWord?.entryId === entryId && learnWord?.language === language
            ? learnWord.index
            : null;
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
              {side.text && activeWord !== null ? (
                splitWords(side.text).map((word, index) => (
                  <span
                    key={index}
                    className={
                      index === activeWord
                        ? "rounded bg-gold/40 px-0.5 font-semibold"
                        : undefined
                    }
                  >
                    {word}{" "}
                  </span>
                ))
              ) : side.text ? (
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
              <button
                type="button"
                onClick={() => onLearn(language)}
                disabled={!side.text || !canPlay || translating}
                aria-expanded={learnOpen}
                aria-label={`Learn ${item.label} pronunciation`}
                title="Practise: play the recording with controls, or hear it word by word"
                className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green disabled:cursor-not-allowed disabled:opacity-40"
              >
                Learn
              </button>
            </div>
            {learnOpen ? (
              <LearnPlayer
                url={saved?.url ?? null}
                getSpeaker={getSpeaker}
                onLoadClip={onLoadClip}
                loop={learnLoop}
                onLoopChange={onLoopChange}
                wordsActive={activeWord !== null}
                onWords={() => onLearnWords(language)}
                onStop={onStop}
              />
            ) : null}
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

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * Learn mode player: the controls a learner actually asked for — play and
 * pause, a seek bar, a 5-second rewind, looping, and a word-by-word pass
 * that speaks each word separately with pauses between. It drives the
 * shared page audio element, so it agrees with Speak/Replay about what
 * is playing, and the Speech speed control applies to everything here.
 */
function LearnPlayer({
  url,
  getSpeaker,
  onLoadClip,
  loop,
  onLoopChange,
  wordsActive,
  onWords,
  onStop,
}: {
  url: string | null;
  getSpeaker: () => HTMLAudioElement | null;
  onLoadClip: (url: string) => void;
  loop: boolean;
  onLoopChange: (loop: boolean) => void;
  wordsActive: boolean;
  onWords: () => void;
  onStop: () => void;
}) {
  const [, tick] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, []);

  const audio = getSpeaker();
  const loaded = Boolean(audio && url && audio.src === url);
  const duration = loaded && audio ? audio.duration || 0 : 0;
  const current = loaded && audio ? audio.currentTime || 0 : 0;
  const playing = loaded && audio ? !audio.paused && !audio.ended : false;

  const togglePlay = () => {
    if (!url) return;
    const speaker = getSpeaker();
    if (!speaker || speaker.src !== url || speaker.ended) {
      onLoadClip(url);
      return;
    }
    if (speaker.paused) void speaker.play().catch(() => {});
    else speaker.pause();
  };

  return (
    <div className="mt-4 rounded-2xl border border-line bg-paper p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={togglePlay}
          disabled={!url}
          aria-label={playing ? "Pause the recording" : "Play the recording"}
          className="rounded-full bg-green-ink px-4 py-2 text-sm font-semibold text-card hover:bg-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green disabled:cursor-not-allowed disabled:opacity-40"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          onClick={() => {
            const speaker = getSpeaker();
            if (speaker && url && speaker.src === url) {
              speaker.currentTime = Math.max(0, speaker.currentTime - 5);
            }
          }}
          disabled={!loaded}
          aria-label="Back 5 seconds"
          className="rounded-full border border-line px-3 py-2 text-sm font-semibold hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green disabled:cursor-not-allowed disabled:opacity-40"
        >
          ⏪ 5s
        </button>
        <span className="text-sm tabular-nums text-muted">
          {formatClock(current)} / {formatClock(duration)}
        </span>
        <button
          type="button"
          aria-pressed={loop}
          onClick={() => {
            const next = !loop;
            onLoopChange(next);
            const speaker = getSpeaker();
            if (speaker && url && speaker.src === url) speaker.loop = next;
          }}
          className={
            loop
              ? "rounded-full border border-green bg-green px-3 py-2 text-sm font-semibold text-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
              : "rounded-full border border-line px-3 py-2 text-sm font-semibold hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
          }
        >
          Loop
        </button>
        {wordsActive ? (
          <button
            type="button"
            onClick={onStop}
            className="rounded-full border border-line px-3 py-2 text-sm font-semibold hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
          >
            Stop words
          </button>
        ) : (
          <button
            type="button"
            onClick={onWords}
            className="rounded-full border border-line px-3 py-2 text-sm font-semibold hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
          >
            Word by word
          </button>
        )}
      </div>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={Math.min(current, duration || 0)}
        disabled={!loaded}
        aria-label="Seek through the recording"
        onChange={(event) => {
          const speaker = getSpeaker();
          if (speaker && url && speaker.src === url) {
            speaker.currentTime = Number(event.target.value);
          }
        }}
        className="mt-3 w-full accent-green"
      />
      <p className="mt-2 text-sm text-muted">
        {url
          ? "Practise with the recording: pause it, rewind, loop it, or hear the sentence word by word with pauses between the words. Speech speed applies here too."
          : "Press Speak once and the recording will load here with these controls. Word by word works right away — it fetches each word on its own."}
      </p>
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
