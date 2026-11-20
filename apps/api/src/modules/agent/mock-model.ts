import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});

const stream = (parts: LanguageModelV4StreamPart[]) => ({
  stream: new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      for (const p of parts) controller.enqueue(p);
      controller.close();
    },
  }),
});

/** Último resultado de herramienta que el modelo recibió, como objeto. */
export function lastToolResult(options: LanguageModelV4CallOptions): unknown {
  for (const message of [...options.prompt].reverse()) {
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (part.type === "tool-result" && part.output.type === "json") return part.output.value;
    }
  }
  return undefined;
}

/**
 * Modelo de prueba: en el primer paso pide `tool` con `input`; en el segundo responde con lo que
 * diga `answer` a partir del resultado de la herramienta (como haría un modelo real que no inventa).
 */
export function scriptedModel(tool: string, input: unknown, answer: (result: unknown) => string) {
  return new MockLanguageModelV4({
    doStream: async (options) => {
      const result = lastToolResult(options);
      if (result === undefined) {
        return stream([
          { type: "stream-start", warnings: [] },
          { type: "tool-call", toolCallId: "call-1", toolName: tool, input: JSON.stringify(input) },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool_calls" },
            usage: usage(300, 20),
          },
        ]);
      }
      return stream([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: answer(result) },
        { type: "text-end", id: "t1" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage: usage(500, 40),
        },
      ]);
    },
  });
}

/** Modelo de visión de prueba: responde `text` y deja ver qué recibió. */
export function visionModel(text: string) {
  const calls: LanguageModelV4CallOptions[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      calls.push(options);
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: usage(1200, 40),
        warnings: [],
      };
    },
  });
  return { model, calls };
}
