import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { EmbeddingModel, LanguageModel } from "ai";
import type { Env } from "../../env";

/** Modelo por defecto de Workers AI: llama con herramientas y buen español. */
export const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Modelo de visión por defecto para leer recibos: Gemma 4 lee texto en fotos (OCR) en español. */
export const DEFAULT_VISION_MODEL = "@cf/google/gemma-4-26b-a4b-it";

/** Embeddings multilingües (1024 dimensiones) para buscar movimientos por significado. */
export const DEFAULT_EMBEDDING_MODEL = "@cf/baai/bge-m3";

/** Crea el modelo de embeddings del entorno, o `undefined` si la IA no está configurada. */
export type EmbedderFactory = (env: Env) => EmbeddingModel | undefined;

/** Crea el modelo del entorno, o `undefined` si la IA no está configurada. */
export type ModelFactory = (env: Env) => LanguageModel | undefined;

/**
 * Cualquier proveedor compatible con la API de OpenAI. Por defecto, Workers AI de la cuenta
 * (`CLOUDFLARE_ACCOUNT_ID` + `AI_API_KEY`); con `AI_BASE_URL` y `AI_MODEL` se cambia de proveedor
 * sin tocar el código.
 */
export const openAiCompatibleModel: ModelFactory = (env) =>
  compatibleModel(env, env.AI_MODEL ?? DEFAULT_MODEL);

/** El mismo proveedor con un modelo que entiende imágenes (`AI_VISION_MODEL` para cambiarlo). */
export const openAiCompatibleVisionModel: ModelFactory = (env) =>
  compatibleModel(env, env.AI_VISION_MODEL ?? DEFAULT_VISION_MODEL);

export const openAiCompatibleEmbedder: EmbedderFactory = (env) =>
  compatibleProvider(env)?.embeddingModel(env.AI_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL);

function compatibleModel(env: Env, modelId: string): LanguageModel | undefined {
  return compatibleProvider(env)?.chatModel(modelId);
}

function compatibleProvider(env: Env) {
  if (!env.AI_API_KEY) return undefined;
  const baseURL =
    env.AI_BASE_URL ??
    (env.CLOUDFLARE_ACCOUNT_ID
      ? `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1`
      : undefined);
  if (!baseURL) return undefined;
  return createOpenAICompatible({ name: "lukas-ai", baseURL, apiKey: env.AI_API_KEY });
}
