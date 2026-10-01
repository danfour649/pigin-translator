import type { LanguageId } from "@/lib/languages";

export function recognitionSupported(): boolean {
  return getRecognitionConstructor() !== undefined;
}

export function synthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function createRecognition(): SpeechRecognition | null {
  const Recognition = getRecognitionConstructor();
  if (!Recognition) return null;

  const recognition = new Recognition();
  recognition.lang = "en-US";
  recognition.continuous = false;
  recognition.interimResults = true;
  return recognition;
}

export type VoiceChoice = {
  voice: SpeechSynthesisVoice | null;
  ideal: boolean;
  note: string;
};

export function chooseVoice(
  language: LanguageId,
  voices: SpeechSynthesisVoice[],
): VoiceChoice {
  if (language === "yoruba") {
    const yoruba = voices.find((voice) =>
      voice.lang.toLowerCase().replaceAll("_", "-").startsWith("yo"),
    );
    if (yoruba) {
      return {
        voice: yoruba,
        ideal: true,
        note: `Speaking with ${yoruba.name}.`,
      };
    }

    return {
      voice: englishFallback(voices),
      ideal: false,
      note: "This browser has no Yorùbá voice, so playback uses a fallback and the tones will not sound right. Optional cloud voices are described in the README.",
    };
  }

  const nigerian = voices.find((voice) => {
    const lang = voice.lang.toLowerCase().replaceAll("_", "-");
    return lang.startsWith("en-ng") || /nigeria/i.test(voice.name);
  });

  if (nigerian) {
    return {
      voice: nigerian,
      ideal: true,
      note: `Speaking with ${nigerian.name}.`,
    };
  }

  return {
    voice: englishFallback(voices),
    ideal: false,
    note: "No Nigerian English voice was found. Naijá will play with a general English voice.",
  };
}

export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!synthesisSupported()) return Promise.resolve([]);

  const existing = window.speechSynthesis.getVoices();
  if (existing.length > 0) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const finish = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", finish);
      resolve(window.speechSynthesis.getVoices());
    };

    window.speechSynthesis.addEventListener("voiceschanged", finish);
    window.setTimeout(finish, 800);
  });
}

function englishFallback(
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  return (
    voices.find((voice) => voice.lang.toLowerCase().startsWith("en")) ??
    voices[0] ??
    null
  );
}

function getRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}
