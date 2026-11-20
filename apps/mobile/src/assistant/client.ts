import { type AssistantReply, parseAssistantStream } from "./stream";

export interface ChatTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export type AssistantError =
  | { readonly kind: "signed_out" }
  | { readonly kind: "quota" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "network" }
  | { readonly kind: "unexpected"; readonly status: number };

export type AssistantResult =
  | { readonly ok: true; readonly value: AssistantReply }
  | { readonly ok: false; readonly error: AssistantError };

export interface AssistantClient {
  chat(token: string, turns: readonly ChatTurn[]): Promise<AssistantResult>;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Cuántos turnos previos se mandan: el contexto justo para seguir la conversación. */
export const HISTORY = 12;

const errorFor = (status: number): AssistantError => {
  if (status === 401) return { kind: "signed_out" };
  if (status === 429) return { kind: "quota" };
  if (status === 503) return { kind: "unavailable" };
  return { kind: "unexpected", status };
};

/**
 * Cliente de `POST /v1/agent/chat`. Lee la respuesta completa y luego la interpreta: el `fetch`
 * de React Native no expone el cuerpo por partes y las respuestas son cortas.
 */
export function createAssistantClient(apiUrl: string, fetchImpl: Fetch = fetch): AssistantClient {
  return {
    async chat(token, turns) {
      const messages = turns
        .filter((m) => m.content.trim().length > 0)
        .slice(-HISTORY)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
      let res: Response;
      try {
        res = await fetchImpl(`${apiUrl}/v1/agent/chat`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ messages }),
        });
      } catch {
        return { ok: false, error: { kind: "network" } };
      }
      if (!res.ok) return { ok: false, error: errorFor(res.status) };
      try {
        return { ok: true, value: parseAssistantStream(await res.text()) };
      } catch {
        return { ok: false, error: { kind: "network" } };
      }
    },
  };
}
