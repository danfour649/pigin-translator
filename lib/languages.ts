export const LANGUAGES = {
  naija: {
    id: "naija",
    label: "Naijá",
    description: "Nigerian Pidgin",
    htmlLang: "pcm",
  },
  yoruba: {
    id: "yoruba",
    label: "Yorùbá",
    description: "Yorùbá",
    htmlLang: "yo",
  },
} as const;

export type LanguageId = keyof typeof LANGUAGES;

export const LANGUAGE_IDS = Object.keys(LANGUAGES) as LanguageId[];

export function isLanguageId(value: unknown): value is LanguageId {
  return value === "naija" || value === "yoruba";
}

export const EXAMPLE_PHRASES = [
  "Good morning. How are you today?",
  "Please show me the way to the market.",
  "How much does this cost?",
  "I will call you tomorrow evening.",
] as const;

export const MAX_SOURCE_LENGTH = 4000;
