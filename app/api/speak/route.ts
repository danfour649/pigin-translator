import {
  AZURE_VOICES,
  AzureSpeechError,
  azureSpeechConfigured,
  parseSpeakBody,
  synthesizeAzureSpeech,
} from "@/lib/azure-speech";
import {
  clientAddress,
  decideSpeakAccess,
  speakCounterStore,
} from "@/lib/speak-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function GET() {
  return Response.json({
    configured: azureSpeechConfigured(),
    voices: {
      naija: AZURE_VOICES.naija.name,
      yoruba: AZURE_VOICES.yoruba.name,
    },
  });
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Send a JSON body with text and language." },
      { status: 400 },
    );
  }

  const parsed = parseSpeakBody(body);
  if (!parsed.ok) {
    return Response.json({ error: parsed.message }, { status: parsed.status });
  }

  if (!azureSpeechConfigured()) {
    return Response.json(
      { error: "Azure Speech is not configured." },
      { status: 503 },
    );
  }

  const access = await decideSpeakAccess({
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
    ip: clientAddress(request.headers),
    textLength: parsed.text.length,
    now: Date.now(),
    env: process.env,
    store: speakCounterStore(),
  });
  if (!access.ok) {
    return Response.json(
      { error: access.message },
      { status: access.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const audio = await synthesizeAzureSpeech(parsed.text, parsed.language);
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const status = error instanceof AzureSpeechError ? error.status : 502;
    const message =
      error instanceof AzureSpeechError
        ? error.message
        : "Azure Speech could not synthesize audio.";
    return Response.json({ error: message }, { status });
  }
}
