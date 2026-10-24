import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TRANSLATION_MODEL_ID,
  TRANSLATION_MODELS,
  translationModelById,
} from "./translation-models.ts";

test("the default translation model is GPT-6 Astra", () => {
  assert.equal(DEFAULT_TRANSLATION_MODEL_ID, "openai/gpt-6-astra");
  assert.equal(translationModelById(DEFAULT_TRANSLATION_MODEL_ID).label, "GPT-6 Astra");
  assert.equal(TRANSLATION_MODELS[0].id, DEFAULT_TRANSLATION_MODEL_ID);
});

test("all five models stay selectable", () => {
  assert.deepEqual(
    TRANSLATION_MODELS.map((model) => model.id),
    [
      "openai/gpt-6-astra",
      "openai/gpt-6.1-sol",
      "openai/gpt-5.4",
      "google/gemini-2.5-flash-lite",
      "google/gemini-3.1-flash-lite",
    ],
  );
});
