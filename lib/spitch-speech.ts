import type { LanguageId } from "@/lib/languages";

/**
 * Speak uses Spitch's stock voices: Yorùbá in sade, Naijá in tayo.
 * The key is read from SPITCH_API_KEY and is never returned to the client.
 */
export const SPITCH_SPEECH_URL = "https://api.spitch.app/v1/speech";
export const SPITCH_YORUBA_VOICE = "sade";
// Spitch's Nigerian Pidgin voice, cited in published research using Spitch
// and listed in the Nigerian Pidgin section of Spitch's voice roster.
// It has not been live-verified against this account yet: confirm it on the
// preview deployment (a voice-not-found style error there means the roster
// name for this account differs, while a 502 matching Yorùbá is the
// provider being down, not the voice being wrong).
export const SPITCH_NAIJA_VOICE = "tayo";

export type SpitchSpeechConfig = { language: string; voice: string };

export const SPITCH_SPEECH_CONFIG: Record<LanguageId, SpitchSpeechConfig> = {
  yoruba: { language: "yo", voice: SPITCH_YORUBA_VOICE },
  // Nigerian Pidgin's ISO 639-3 code is "pcm".
  naija: { language: "pcm", voice: SPITCH_NAIJA_VOICE },
};

export function spitchSpeechConfigured(): boolean {
  return Boolean(spitchKey());
}

export async function synthesizeSpitchSpeech(
  text: string,
  fetchImpl: typeof fetch = fetch,
  language: LanguageId = "yoruba",
): Promise<ArrayBuffer> {
  const key = spitchKey();
  if (!key) {
    throw new SpitchSpeechError(503, "Spitch is not configured.");
  }

  const config = SPITCH_SPEECH_CONFIG[language];
  const response = await fetchImpl(SPITCH_SPEECH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      language: config.language,
      voice: config.voice,
      format: "mp3",
      text,
    }),
  });

  if (!response.ok) {
    console.error(`Spitch speech failed (${response.status})`);
    throw new SpitchSpeechError(
      response.status === 401 ? 401 : 502,
      "Spitch could not synthesize audio.",
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json") || contentType.startsWith("text/")) {
    console.error("Spitch speech returned a non-audio response");
    throw new SpitchSpeechError(502, "Spitch could not synthesize audio.");
  }

  const audio = await response.arrayBuffer();
  if (audio.byteLength === 0) {
    throw new SpitchSpeechError(502, "Spitch returned empty audio.");
  }

  return audio;
}

export class SpitchSpeechError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "SpitchSpeechError";
    this.status = status;
  }
}

function spitchKey(): string | undefined {
  const key = process.env.SPITCH_API_KEY?.trim();
  return key ? key : undefined;
}
