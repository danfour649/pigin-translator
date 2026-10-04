/**
 * Yorùbá Speak uses Spitch's stock voice sade. Naijá does not.
 * The key is read from SPITCH_API_KEY and is never returned to the client.
 */
export const SPITCH_SPEECH_URL = "https://api.spitch.app/v1/speech";
export const SPITCH_YORUBA_VOICE = "sade";

export function spitchSpeechConfigured(): boolean {
  return Boolean(spitchKey());
}

export async function synthesizeSpitchSpeech(
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ArrayBuffer> {
  const key = spitchKey();
  if (!key) {
    throw new SpitchSpeechError(503, "Spitch is not configured.");
  }

  const response = await fetchImpl(SPITCH_SPEECH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      language: "yo",
      voice: SPITCH_YORUBA_VOICE,
      format: "mp3",
      text,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).replaceAll(key, "[redacted]");
    console.error(
      `Spitch speech failed (${response.status})`,
      detail.slice(0, 300),
    );
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
