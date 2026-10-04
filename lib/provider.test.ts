import assert from "node:assert/strict";
import test from "node:test";
import { describeModelFailure } from "./provider.ts";

test("a gateway rejection names the model and keeps the reason", () => {
  const error = Object.assign(
    new Error(
      "Free tier users do not have access to this model. Upgrade to paid credits.",
    ),
    { statusCode: 403, name: "GatewayInternalServerError" },
  );

  const message = describeModelFailure("GPT-5.4", error);

  assert.match(message, /GPT-5.4 was rejected by the AI Gateway/);
  assert.match(message, /Free tier users do not have access to this model/);
});

test("other failures still name the chosen model", () => {
  const message = describeModelFailure(
    "Gemini 3.1 Flash Lite",
    new Error("The upstream timed out."),
  );

  assert.equal(
    message,
    "Gemini 3.1 Flash Lite could not translate. The upstream timed out.",
  );
});
