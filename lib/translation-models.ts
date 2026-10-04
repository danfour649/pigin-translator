export const TRANSLATION_MODELS = [
  {
    id: "google/gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash Lite",
    note: "Free model this site uses now",
  },
  {
    id: "google/gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    note: "Newer Gemini",
  },
  {
    id: "openai/gpt-5.4",
    label: "GPT-5.4",
    note: "Paid",
  },
] as const;

export type TranslationModelId = (typeof TRANSLATION_MODELS)[number]["id"];

export const DEFAULT_TRANSLATION_MODEL_ID: TranslationModelId =
  "google/gemini-2.5-flash-lite";

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
