import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { APICallError, gateway, type LanguageModel } from "ai";

/**
 * Paid AI Gateway model for translation. The project owner funds gateway
 * credits.
 */
export const GATEWAY_MODEL_IDS = ["openai/gpt-5.4"] as const;

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
 * 1. Each AI Gateway model in GATEWAY_MODEL_IDS, when AI_GATEWAY_API_KEY or
 *    VERCEL_OIDC_TOKEN is set, or when the app is running on Vercel.
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
    for (const modelId of GATEWAY_MODEL_IDS) {
      choices.push({
        model: gateway(modelId),
        provider: "ai-gateway",
        modelId,
      });
    }
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

/** Authentication failed. Skip the rest of the gateway list and try a direct key. */
export function isCredentialError(error: unknown): boolean {
  for (const entry of errorChain(error)) {
    if (errorName(entry) === "GatewayAuthenticationError") return true;
    if (errorName(entry) === "LoadAPIKeyError") return true;
    if (statusOf(entry) === 401) return true;
  }

  return false;
}

/**
 * This model is not available on the current plan. Try the next model.
 * Covers free-tier RestrictedModelsError, HTTP 403, and no_providers_available.
 */
export function isRetryableModelChoiceError(error: unknown): boolean {
  if (isCredentialError(error)) return false;

  for (const entry of errorChain(error)) {
    const name = errorName(entry);
    if (name === "RestrictedModelsError" || name === "GatewayForbiddenError") {
      return true;
    }
    if (statusOf(entry) === 403) return true;

    const blob = errorBlob(entry);
    if (
      blob.includes("no_providers_available") ||
      blob.includes("RestrictedModelsError") ||
      /free tier/i.test(blob) ||
      /do not have access/i.test(blob)
    ) {
      return true;
    }
  }

  return false;
}

/** Index of the next model to try, or null when the failure should stop the loop. */
export function nextModelIndex(
  choices: ModelChoice[],
  index: number,
  error: unknown,
): number | null {
  if (isRetryableModelChoiceError(error)) {
    return index + 1 < choices.length ? index + 1 : null;
  }

  if (isCredentialError(error)) {
    for (let next = index + 1; next < choices.length; next++) {
      if (choices[next]?.provider !== "ai-gateway") return next;
    }
  }

  return null;
}

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current = error;

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }

  return chain;
}

function errorName(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

function statusOf(error: unknown): number | undefined {
  if (APICallError.isInstance(error)) return error.statusCode;
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === "number" ? status : undefined;
}

function errorBlob(error: unknown): string {
  if (!error || typeof error !== "object") return "";

  const record = error as {
    message?: unknown;
    type?: unknown;
    code?: unknown;
    responseBody?: unknown;
    data?: unknown;
  };
  const parts: string[] = [];

  if (typeof record.message === "string") parts.push(record.message);
  if (typeof record.type === "string") parts.push(record.type);
  if (typeof record.code === "string" || typeof record.code === "number") {
    parts.push(String(record.code));
  }
  if (typeof record.responseBody === "string") parts.push(record.responseBody);

  if (record.data !== undefined) {
    try {
      parts.push(JSON.stringify(record.data));
    } catch {
      // Ignore data that cannot be serialized.
    }
  }

  return parts.join("\n");
}
