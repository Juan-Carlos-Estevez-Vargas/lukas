import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { Env } from "../../env";

/** Modelo por defecto de Workers AI: llama con herramientas y buen español. */
export const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Crea el modelo del entorno, o `undefined` si la IA no está configurada. */
export type ModelFactory = (env: Env) => LanguageModel | undefined;

/**
 * Cualquier proveedor compatible con la API de OpenAI. Por defecto, Workers AI de la cuenta
 * (`CLOUDFLARE_ACCOUNT_ID` + `AI_API_KEY`); con `AI_BASE_URL` y `AI_MODEL` se cambia de proveedor
 * sin tocar el código.
 */
export const openAiCompatibleModel: ModelFactory = (env) => {
  if (!env.AI_API_KEY) return undefined;
  const baseURL =
    env.AI_BASE_URL ??
    (env.CLOUDFLARE_ACCOUNT_ID
      ? `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1`
      : undefined);
  if (!baseURL) return undefined;
  const provider = createOpenAICompatible({ name: "lukas-ai", baseURL, apiKey: env.AI_API_KEY });
  return provider.chatModel(env.AI_MODEL ?? DEFAULT_MODEL);
};
