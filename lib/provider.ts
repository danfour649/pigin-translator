import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { APICallError, gateway, type LanguageModel } from "ai";

export const GATEWAY_MODEL_ID = "openai/gpt-6-astra";
export const OPENAI_MODEL_ID = "gpt-6-astra";
export const ANTHROPIC_MODEL_ID = "claude-sonnet-5-5";

export type ProviderName = "ai-gateway" | "openai" | "anthropic";

export type ModelChoice = {
  model: LanguageModel;
  provider: ProviderName;
  modelId: string;
};

/**
 * Credential order:
 * 1. AI Gateway when AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN is set, or when
 *    the app is running on Vercel (OIDC is issued there without a repo key).
 * 2. OpenAI when OPENAI_API_KEY is set.
 * 3. Anthropic when ANTHROPIC_API_KEY is set.
 * Keys are read only in this server module.
 */
export function listModelChoices(): ModelChoice[] {
  const choices: ModelChoice[] = [];
  const gatewayReady = Boolean(
    process.env.AI_GATEWAY_API_KEY ||
      process.env.VERCEL_OIDC_TOKEN ||
      process.env.VERCEL === "1",
  );

  if (gatewayReady) {
    choices.push({
      model: gateway(GATEWAY_MODEL_ID),
      provider: "ai-gateway",
      modelId: GATEWAY_MODEL_ID,
    });
  }

  if (process.env.OPENAI_API_KEY) {
    choices.push({
      model: openai(OPENAI_MODEL_ID),
      provider: "openai",
      modelId: OPENAI_MODEL_ID,
    });
  }

  if (process.env.ANTHROPIC_API_KEY) {
    choices.push({
      model: anthropic(ANTHROPIC_MODEL_ID),
      provider: "anthropic",
      modelId: ANTHROPIC_MODEL_ID,
    });
  }

  return choices;
}

export function isCredentialError(error: unknown): boolean {
  if (APICallError.isInstance(error)) {
    return error.statusCode === 401 || error.statusCode === 403;
  }

  return (
    error instanceof Error &&
    (error.name === "GatewayAuthenticationError" ||
      error.name === "LoadAPIKeyError")
  );
}
