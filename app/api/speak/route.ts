import {
  AZURE_VOICES,
  AzureSpeechError,
  azureSpeechConfigured,
  parseSpeakBody,
  synthesizeAzureSpeech,
} from "@/lib/azure-speech";
import { chooseSpeakBackend } from "@/lib/speak-cloud";
import {
  clientAddress,
  decideSpeakAccess,
  speakCounterStore,
} from "@/lib/speak-guard";
import {
  SPITCH_YORUBA_VOICE,
  SpitchSpeechError,
  spitchSpeechConfigured,
  synthesizeSpitchSpeech,
} from "@/lib/spitch-speech";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function GET() {
  const azure = azureSpeechConfigured();
  const spitch = spitchSpeechConfigured();
  return Response.json({
    configured: azure || spitch,
    providers: {
      naija: azure ? "azure" : null,
      yoruba: spitch ? "spitch" : null,
    },
    voices: {
      naija: AZURE_VOICES.naija.name,
      yoruba: SPITCH_YORUBA_VOICE,
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

  const backend = chooseSpeakBackend(parsed.language, {
    azure: azureSpeechConfigured(),
    spitch: spitchSpeechConfigured(),
  });
  if (!backend) {
    return Response.json(
      { error: "Cloud speech is not configured." },
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
    const audio =
      backend === "spitch"
        ? await synthesizeSpitchSpeech(parsed.text)
        : await synthesizeAzureSpeech(parsed.text, parsed.language);
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AzureSpeechError || error instanceof SpitchSpeechError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json(
      { error: "Cloud speech could not synthesize audio." },
      { status: 502 },
    );
  }
}
