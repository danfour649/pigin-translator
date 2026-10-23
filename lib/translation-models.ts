export const TRANSLATION_MODELS = [
  {
    id: "openai/gpt-6-astra",
    label: "GPT-6 Astra",
    note: "Flagship. Newest OpenAI.",
  },
  {
    id: "openai/gpt-6.1-sol",
    label: "GPT-6.1 Sol",
    note: "Newer. Faster, cheaper.",
  },
  {
    id: "openai/gpt-5.4",
    label: "GPT-5.4",
    note: "Paid. Selected by default.",
  },
  {
    id: "google/gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash Lite",
    note: "Free",
  },
  {
    id: "google/gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    note: "Newer Gemini",
  },
] as const;

export type TranslationModelId = (typeof TRANSLATION_MODELS)[number]["id"];

export const DEFAULT_TRANSLATION_MODEL_ID: TranslationModelId =
  "openai/gpt-5.4";

export function isTranslationModelId(
  value: unknown,
): value is TranslationModelId {
  return TRANSLATION_MODELS.some((model) => model.id === value);
}

export function translationModelById(id: TranslationModelId) {
  const model = TRANSLATION_MODELS.find((item) => item.id === id);
  if (!model) {
    throw new Error(`Unknown translation model: ${id}`);
  }
  return model;
}
