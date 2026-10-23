import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { translationFailureLog } from "./safe-error.ts";

const PROMPT = "my husband is vaping every time";

test("translation failure log keeps status and drops request text", () => {
  const error = Object.assign(new Error(`Provider said: ${PROMPT}`), {
    name: "AI_APICallError",
    statusCode: 400,
    responseBody: JSON.stringify({ prompt: PROMPT }),
    requestBodyValues: { prompt: PROMPT, system: PROMPT },
    cause: new Error(PROMPT),
    data: { text: PROMPT },
  });

  const line = translationFailureLog("ai-gateway", "openai/gpt-5.4", error);

  assert.equal(
    line,
    "Translation with ai-gateway (openai/gpt-5.4) failed (AI_APICallError 400)",
  );
  assert.equal(line.includes(PROMPT), false);
});

test("a prompt used as the error name is not logged", () => {
  const error = Object.assign(new Error(PROMPT), {
    name: PROMPT,
    statusCode: 502,
  });

  const line = translationFailureLog("ai-gateway", "openai/gpt-5.4", error);

  assert.equal(line.includes(PROMPT), false);
  assert.match(line, /failed \(Error 502\)/);
});

test("translate and speech error logs do not print request text", () => {
  const translate = readFileSync("app/api/translate/route.ts", "utf8");
  const speak = readFileSync("app/api/speak/route.ts", "utf8");
  const azure = readFileSync("lib/azure-speech.ts", "utf8");
  const spitch = readFileSync("lib/spitch-speech.ts", "utf8");

  assert.match(translate, /translationFailureLog\(/);
  assert.doesNotMatch(translate, /console\.error\(\s*`Translation[\s\S]*?,\s*error\s*,/);
  assert.equal(speak.includes("console."), false);
  assert.doesNotMatch(azure, /response\.text\(/);
  // Spitch may read its upstream error body, but only through
  // sanitizeSpitchDetail, which redacts the API key and the request text
  // before anything is logged; spitch-speech.test.ts pins that behaviour
  // with an upstream body containing both.
  assert.match(spitch, /sanitizeSpitchDetail\(/);
  assert.match(azure, /Azure Speech failed \(\$\{response\.status\}\)/);
  assert.match(spitch, /Spitch speech failed \(\$\{response\.status\}\)/);
});
