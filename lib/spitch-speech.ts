import type { LanguageId } from "@/lib/languages";

/**
 * Speak uses Spitch's stock voices: Yorùbá in sade, Naijá in boma.
 * The key is read from SPITCH_API_KEY and is never returned to the client.
 */
export const SPITCH_SPEECH_URL = "https://api.spitch.app/v1/speech";
export const SPITCH_YORUBA_VOICE = "sade";
// Spitch's Nigerian Pidgin voice. Voice IDs verified 2026-10-23 against
// Spitch's docs voice roster (Nigerian Pidgin section: Justice, Boma, Tega,
// Ufoma) and the official Spitch Python SDK's voice list. The previous value
// "tayo" is not a valid Spitch voice ID, which is why Naijá synthesis failed
// while Yorùbá worked. Boma is feminine, like the Azure Ezinne voice it
// replaces and like Yorùbá's sade.
export const SPITCH_NAIJA_VOICE = "boma";

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
  const requestSpeech = (body: Record<string, string>) =>
    fetchImpl(SPITCH_SPEECH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

  let response = await requestSpeech({
    language: config.language,
    voice: config.voice,
    format: "mp3",
    text,
  });

  // The Spitch API marks `language` optional, and whether it accepts the
  // ISO 639-3 code "pcm" is unverified. For Naijá only, retry once without
  // the language field: the Pidgin-designed voice carries the language.
  // A 401 is an auth failure and would not change, so it never retries.
  // Yorùbá keeps its single-attempt behaviour.
  if (!response.ok && language === "naija" && response.status !== 401) {
    response = await requestSpeech({
      voice: config.voice,
      format: "mp3",
      text,
    });
  }

  if (!response.ok) {
    const detail = sanitizeSpitchDetail(
      await response.text().catch(() => ""),
      key,
      text,
    );
    console.error(
      detail
        ? `Spitch speech failed (${response.status}): ${detail}`
        : `Spitch speech failed (${response.status})`,
    );
    throw new SpitchSpeechError(
      response.status === 401 ? 401 : 502,
      "Spitch could not synthesize audio.",
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json") || contentType.startsWith("text/")) {
    const detail = sanitizeSpitchDetail(
      new TextDecoder().decode(await response.arrayBuffer()),
      key,
      text,
    );
    console.error(
      detail
        ? `Spitch speech returned a non-audio response: ${detail}`
        : "Spitch speech returned a non-audio response",
    );
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

function sanitizeSpitchDetail(
  body: string,
  key: string,
  text: string,
): string {
  let detail = body;
  for (const secret of [key, text]) {
    if (secret) detail = detail.split(secret).join("[redacted]");
  }
  return detail.trim().slice(0, 300);
}

function spitchKey(): string | undefined {
  const key = process.env.SPITCH_API_KEY?.trim();
  return key ? key : undefined;
}
