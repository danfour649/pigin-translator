import assert from "node:assert/strict";
import test from "node:test";
import { parseCatalog, type CatalogItem } from "./catalog.ts";

const item: CatalogItem = {
  id: "item-1",
  english: "my husband is vaping every time",
  naija: "My husband dey vape every time.",
  yoruba: "saved yoruba line",
  modelId: "openai/gpt-5.4",
  modelLabel: "GPT-5.4",
  savedAt: "2026-10-04T12:00:00.000Z",
  correction: {
    english: "",
    naija: "",
    yoruba: "a different yoruba line",
    note: "The kinship word was wrong.",
  },
};

test("catalog keeps a correction with the saved translation", () => {
  const parsed = parseCatalog(JSON.stringify([item, { id: 1 }]));
  assert.deepEqual(parsed, [item]);
});

test("catalog ignores storage that is not a list", () => {
  assert.deepEqual(parseCatalog("nope"), []);
  assert.deepEqual(parseCatalog(null), []);
});
