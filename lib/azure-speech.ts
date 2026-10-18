import {
  isLanguageId,
  MAX_SOURCE_LENGTH,
  type LanguageId,
} from "@/lib/languages";

/**
 * Neural short names sent only from the server.
 * en-NG-EzinneNeural is the current female English (Nigeria) voice in the
 * Azure language-support table. yo-NG-AdeolaNeural is the Yoruba (Nigeria)
 * neural voice for the yo-NG locale.
 */
export const AZURE_VOICES: Record<
  LanguageId,
  { name: string; locale: string }
> = {
  naija: { name: "en-NG-EzinneNeural", locale: "en-NG" },
  yoruba: { name: "yo-NG-AdeolaNeural", locale: "yo-NG" },
};

const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

export function azureSpeechConfigured(): boolean {
  return Boolean(speechKey() && speechRegion());
}

export function escapeSsml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildSsml(text: string, language: LanguageId): string {
  const voice = AZURE_VOICES[language];
  return `<speak version="1.0" xml:lang="${voice.locale}"><voice xml:lang="${voice.locale}" name="${voice.name}">${escapeSsml(text)}</voice></speak>`;
}

export function parseSpeakBody(
  body: unknown,
):
  | { ok: true; text: string; language: LanguageId }
  | { ok: false; status: number; message: string } {
  if (!body || typeof body !== "object") {
    return {
      ok: false,
      status: 400,
      message: "Send a JSON body with text and language.",
    };
  }

  const record = body as { text?: unknown; language?: unknown };
  if (typeof record.text !== "string" || !isLanguageId(record.language)) {
    return {
      ok: false,
      status: 400,
      message: 'Expected { "text": string, "language": "naija" | "yoruba" }.',
    };
  }

  const text = record.text.trim();
  if (!text) {
    return { ok: false, status: 400, message: "Nothing to speak." };
  }

  if (text.length > MAX_SOURCE_LENGTH) {
    return {
      ok: false,
      status: 413,
      message: `Keep the text under ${MAX_SOURCE_LENGTH} characters.`,
    };
  }

  return { ok: true, text, language: record.language };
}

export async function synthesizeAzureSpeech(
  text: string,
  language: LanguageId,
): Promise<ArrayBuffer> {
  const key = speechKey();
  const region = speechRegion();
  if (!key || !region) {
    throw new AzureSpeechError(503, "Azure Speech is not configured.");
  }

  const response = await fetch(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
        "User-Agent": "pigin",
      },
      body: buildSsml(text, language),
    },
  );

  if (!response.ok) {
    console.error(`Azure Speech failed (${response.status})`);
    throw new AzureSpeechError(
      response.status === 401 ? 401 : 502,
      "Azure Speech could not synthesize audio.",
    );
  }

  const audio = await response.arrayBuffer();
  if (audio.byteLength === 0) {
    throw new AzureSpeechError(502, "Azure Speech returned empty audio.");
  }

  return audio;
}

export class AzureSpeechError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AzureSpeechError";
    this.status = status;
  }
}

function speechKey(): string | undefined {
  const key = process.env.AZURE_SPEECH_KEY?.trim();
  return key ? key : undefined;
}

function speechRegion(): string | undefined {
  const region = process.env.AZURE_SPEECH_REGION?.trim().toLowerCase();
  if (!region || !/^[a-z0-9]+$/.test(region)) return undefined;
  return region;
}
