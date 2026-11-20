import { type AgentData, TOOLS, ToolError } from "@lukas/ai-tools";
import {
  type LanguageModel,
  type ModelMessage,
  stepCountIs,
  streamText,
  type ToolSet,
  tool,
} from "ai";
import { redact, redactDeep } from "./redact";

export const SYSTEM_PROMPT = `Eres el asistente de finanzas de Lukas, una app colombiana de finanzas personales.
Hablas en español de Colombia, claro y breve. Los montos van en pesos colombianos con punto de miles (p. ej. $1.250.000) salvo que la cuenta sea en otra moneda.
Reglas:
- Usa las herramientas para cualquier número: nunca inventes ni estimes saldos, gastos o fechas. Si una herramienta no tiene el dato, dilo.
- Hoy es {today} (hora de Colombia). Interpreta "este mes", "el mes pasado" o "ayer" con esa fecha.
- Para registrar, recategorizar o presupuestar usa solo las herramientas propose_*: crean una propuesta que la persona aprueba en la app. Nunca digas que ya guardaste algo.
- No des asesoría de inversión ni recomiendes productos financieros específicos.
- Nunca pidas números de tarjeta, claves, CVV ni datos bancarios.`;

export interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface AgentRun {
  readonly model: LanguageModel;
  readonly data: AgentData;
  readonly messages: readonly ChatMessage[];
  readonly now: Date;
  readonly onUsage: (tokens: number) => Promise<void>;
  readonly onEnd?: () => void;
  readonly newId?: () => string;
}

/** Las herramientas de @lukas/ai-tools para el AI SDK, con sus resultados sin datos personales. */
export function agentTools(data: AgentData, now: Date, newId?: () => string): ToolSet {
  const ctx = { data, now, ...(newId ? { newId } : {}) };
  return Object.fromEntries(
    TOOLS.map((t) => [
      t.name,
      tool({
        description: t.description,
        inputSchema: t.input,
        execute: async (input: unknown) => {
          try {
            return redactDeep(await t.run(ctx, t.input.parse(input)));
          } catch (e) {
            // El modelo recibe el error para corregirse; nada de trazas internas.
            if (e instanceof ToolError) return { error: e.code, message: e.message };
            return { error: "invalid", message: "Entrada inválida para la herramienta" };
          }
        },
      }),
    ]),
  ) as ToolSet;
}

/** Conversación con el agente en streaming. Los mensajes de la persona llegan ya sin datos personales. */
export function runAgent(run: AgentRun) {
  const today = new Date(run.now.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
  const messages: ModelMessage[] = run.messages.map((m) => ({
    role: m.role,
    content: m.role === "user" ? redact(m.content) : m.content,
  }));
  return streamText({
    model: run.model,
    system: SYSTEM_PROMPT.replace("{today}", today),
    messages,
    tools: agentTools(run.data, run.now, run.newId),
    stopWhen: stepCountIs(6),
    maxOutputTokens: 1000,
    temperature: 0.2,
    onEnd: async ({ totalUsage }) => {
      try {
        await run.onUsage(totalUsage.totalTokens ?? 0);
      } finally {
        run.onEnd?.();
      }
    },
    onError: () => run.onEnd?.(),
  });
}
