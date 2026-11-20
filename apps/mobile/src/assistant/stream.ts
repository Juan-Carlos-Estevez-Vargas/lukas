import { type CurrencyCode, isCurrencyCode } from "@lukas/domain";

/** Monto tal como lo manda la API: texto decimal en unidades mayores, nunca `number`. */
export interface WireMoney {
  readonly amount: string;
  readonly currency: CurrencyCode;
}

/**
 * Lo que el asistente propone. La app nunca lo guarda sola: la persona lo acepta, lo edita o lo
 * ignora desde una tarjeta.
 */
export type Proposal =
  | {
      readonly id: string;
      readonly type: "movement";
      readonly summary: string;
      readonly payload: {
        readonly kind: "expense" | "income";
        readonly accountId: string;
        readonly categoryId: string;
        readonly amount: WireMoney;
        readonly date: string;
        readonly merchant: string | null;
        readonly note: string | null;
      };
    }
  | {
      readonly id: string;
      readonly type: "recategorize";
      readonly summary: string;
      readonly payload: { readonly movementId: string; readonly to: string };
    }
  | {
      readonly id: string;
      readonly type: "budget";
      readonly summary: string;
      readonly payload: { readonly categoryId: string | null; readonly amount: WireMoney };
    };

export interface AssistantReply {
  readonly text: string;
  readonly proposals: readonly Proposal[];
  /** El modelo o una herramienta fallaron a mitad de la respuesta. */
  readonly failed: boolean;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 500): string | null =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
const optStr = (v: unknown, max: number): string | null | undefined =>
  v === undefined || v === null ? null : (str(v, max) ?? undefined);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^-?\d{1,15}(\.\d{1,4})?$/;

const money = (v: unknown): WireMoney | null => {
  if (!isObj(v)) return null;
  const amount = str(v.amount, 24);
  const currency = str(v.currency, 3);
  if (!amount || !DECIMAL.test(amount) || !currency || !isCurrencyCode(currency)) return null;
  return { amount, currency };
};

/** Valida una salida de herramienta: lo que llega de la red no se da por bueno. */
export function toProposal(output: unknown): Proposal | null {
  if (!isObj(output) || !isObj(output.payload)) return null;
  const id = str(output.id, 64);
  const summary = str(output.summary);
  if (!id || !summary) return null;
  const p = output.payload;
  switch (output.type) {
    case "movement": {
      const amount = money(p.amount);
      const accountId = str(p.accountId, 64);
      const categoryId = str(p.categoryId, 64);
      const date = str(p.date, 10);
      const merchant = optStr(p.merchant, 80);
      const note = optStr(p.note, 200);
      if (p.kind !== "expense" && p.kind !== "income") return null;
      if (!amount || !accountId || !categoryId || !date || !DAY.test(date)) return null;
      if (merchant === undefined || note === undefined) return null;
      return {
        id,
        type: "movement",
        summary,
        payload: { kind: p.kind, accountId, categoryId, amount, date, merchant, note },
      };
    }
    case "recategorize": {
      const movementId = str(p.movementId, 64);
      const to = str(p.to, 64);
      return movementId && to
        ? { id, type: "recategorize", summary, payload: { movementId, to } }
        : null;
    }
    case "budget": {
      const amount = money(p.amount);
      const categoryId = p.categoryId === null ? null : str(p.categoryId, 64);
      if (!amount || categoryId === undefined) return null;
      if (p.categoryId !== null && categoryId === null) return null;
      return { id, type: "budget", summary, payload: { categoryId, amount } };
    }
    default:
      return null;
  }
}

/**
 * Lee el flujo de mensajes de interfaz del AI SDK (eventos SSE `data: {...}`) y se queda con el
 * texto y las propuestas. Los demás eventos (pasos, entradas de herramientas) se ignoran.
 */
export function parseAssistantStream(body: string): AssistantReply {
  let text = "";
  let failed = false;
  const proposals: Proposal[] = [];
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const raw = line.slice(6).trim();
    if (raw === "[DONE]") break;
    let event: unknown;
    try {
      event = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!isObj(event)) continue;
    if (event.type === "text-delta" && typeof event.delta === "string") text += event.delta;
    else if (event.type === "tool-output-available") {
      const proposal = toProposal(event.output);
      if (proposal && !proposals.some((x) => x.id === proposal.id)) proposals.push(proposal);
    } else if (event.type === "error" || event.type === "tool-output-error") failed = true;
  }
  return { text: text.trim(), proposals, failed };
}
