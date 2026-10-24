import assert from "node:assert/strict";
import test from "node:test";
import { speakCacheKey, speakCacheKeyMaterial } from "./speak-cache.ts";

test("cache key material carries the language, voice and exact text", () => {
  const material = speakCacheKeyMaterial("yoruba", "sade", "Ẹ n lẹ́.");
  assert.match(material, /yoruba/);
  assert.match(material, /sade/);
  assert.ok(material.endsWith("Ẹ n lẹ́."));
});

test("the same line and voice key the same clip", async () => {
  const first = await speakCacheKey("naija", "boma", "How you dey?");
  const second = await speakCacheKey("naija", "boma", "How you dey?");
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
});

test("a changed line keys a fresh clip", async () => {
  const original = await speakCacheKey("yoruba", "sade", "Báwo ni?");
  const edited = await speakCacheKey("yoruba", "sade", "Báwo ni!");
  assert.notEqual(original, edited);
});

test("a changed voice or language keys a fresh clip", async () => {
  const base = await speakCacheKey("naija", "boma", "Wetin dey happen?");
  assert.notEqual(base, await speakCacheKey("naija", "tega", "Wetin dey happen?"));
  assert.notEqual(base, await speakCacheKey("yoruba", "boma", "Wetin dey happen?"));
});

test("an unreported voice still keys by language and text alone", async () => {
  const fromNull = await speakCacheKey("yoruba", null, "Ó dára.");
  const fromUndefined = await speakCacheKey("yoruba", undefined, "Ó dára.");
  assert.equal(fromNull, fromUndefined);
});
