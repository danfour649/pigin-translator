import {
  EXAMPLE_PHRASES,
  isLanguageId,
  LANGUAGES,
  MAX_SOURCE_LENGTH,
  type LanguageId,
} from "@/lib/languages";
import {
  isCredentialError,
  listModelChoices,
  type ProviderName,
} from "@/lib/provider";
import { generateText } from "ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INSTRUCTIONS: Record<LanguageId, string> = {
  naija: `You translate English into Nigerian Pidgin (Naijá).
Write the way people actually speak in Lagos and across southern Nigeria: natural Naijá, not a word-for-word gloss and not formal English with a few slang words dropped in.
Use common written Naijá (dey, no dey, fit, wan, sabi, wetin, abi, na so, shey, dem, una, am, for).
Keep names, numbers, and the speaker's tone.
Return only the translation. No quotes, labels, or notes.`,
  yoruba: `You translate English into Yorùbá.
Use standard modern Yorùbá orthography, including tone marks and the letters ẹ, ọ, ṣ, and gb.
Write natural spoken Yorùbá, not a stiff word-for-word gloss.
Keep names, numbers, and the speaker's tone.
Return only the translation. No quotes, labels, or notes.`,
};

type TranslateResponse = {
  translation: string;
  language: LanguageId;
  provider: ProviderName;
  model: string;
};

export async function GET() {
  const [choice] = listModelChoices();

  return Response.json({
    ready: Boolean(choice),
    provider: choice?.provider ?? null,
    languages: Object.values(LANGUAGES).map((language) => ({
      id: language.id,
      label: language.label,
    })),
    examples: EXAMPLE_PHRASES,
  });
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Send a JSON body with text and language.");
  }

  const parsed = parseBody(body);
  if (!parsed.ok) return errorResponse(parsed.status, parsed.message);

  const choices = listModelChoices();
  if (choices.length === 0) {
    return errorResponse(
      503,
      "No translation credential is configured. On Vercel, enable AI Gateway so OIDC can authenticate. Otherwise set AI_GATEWAY_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY on the server.",
    );
  }

  let lastError: unknown;

  for (let index = 0; index < choices.length; index++) {
    const choice = choices[index];

    try {
      const result = await generateText({
        model: choice.model,
        system: INSTRUCTIONS[parsed.language],
        prompt: parsed.text,
        maxOutputTokens: 2000,
        timeout: 45_000,
      });
      const translation = cleanTranslation(result.text);

      if (!translation) {
        return errorResponse(502, "The model returned an empty translation.");
      }

      const payload: TranslateResponse = {
        translation,
        language: parsed.language,
        provider: choice.provider,
        model: choice.modelId,
      };

      return Response.json(payload);
    } catch (error) {
      lastError = error;
      const anotherChoice = index < choices.length - 1;
      console.error(
        `Translation with ${choice.provider} (${choice.modelId}) failed`,
        error,
      );

      if (anotherChoice && isCredentialError(error)) continue;
      break;
    }
  }

  console.error("Translation failed", lastError);
  return errorResponse(
    502,
    "Translation failed. Check the server logs and the configured API credential.",
  );
}

function parseBody(
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
    return { ok: false, status: 400, message: "Enter some English to translate." };
  }

  if (text.length > MAX_SOURCE_LENGTH) {
    return {
      ok: false,
      status: 413,
      message: `Keep the English text under ${MAX_SOURCE_LENGTH} characters.`,
    };
  }

  return { ok: true, text, language: record.language };
}

function cleanTranslation(raw: string): string {
  let text = raw.trim();
  text = text.replace(
    /^(translation|naijá|naija|pidgin|yorùbá|yoruba)\s*:\s*/i,
    "",
  );

  const wrapped =
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("“") && text.endsWith("”"));

  if (wrapped) text = text.slice(1, -1).trim();
  return text;
}

function errorResponse(status: number, message: string) {
  return Response.json({ error: message }, { status });
}
