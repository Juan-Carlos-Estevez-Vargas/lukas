import { civilDate } from "../accounts/credit-card";
import { occurredAtOf } from "../assistant/proposals";
import { toWireMoney, type WireMoney } from "../assistant/stream";

/** Lo que la API leyó del recibo. Nada de esto se guarda hasta que la persona revisa y guarda. */
export interface ReceiptReading {
  readonly merchant: string | null;
  readonly amount: WireMoney | null;
  readonly date: string | null;
}

export type ReadError =
  | { readonly kind: "signed_out" }
  | { readonly kind: "quota" }
  | { readonly kind: "premium" }
  | { readonly kind: "unreadable" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "network" }
  | { readonly kind: "unexpected"; readonly status: number };

export type ReadResult =
  | { readonly ok: true; readonly value: ReceiptReading }
  | { readonly ok: false; readonly error: ReadError };

export interface ReceiptReader {
  read(token: string, image: { base64: string; mediaType: string }): Promise<ReadResult>;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const ERRORS: Record<number, ReadError> = {
  401: { kind: "signed_out" },
  402: { kind: "premium" },
  422: { kind: "unreadable" },
  429: { kind: "quota" },
  503: { kind: "unavailable" },
};

/** Valida la respuesta: lo que llega de la red no se da por bueno. */
export function toReading(body: unknown): ReceiptReading | null {
  if (typeof body !== "object" || body === null) return null;
  const o = body as Record<string, unknown>;
  const merchant =
    typeof o.merchant === "string" && o.merchant.trim() ? o.merchant.trim().slice(0, 80) : null;
  const amount = o.amount === null ? null : toWireMoney(o.amount);
  const date = typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : null;
  return merchant || amount ? { merchant, amount, date } : null;
}

/** Cliente de `POST /v1/agent/receipt`. */
export function createReceiptReader(apiUrl: string, fetchImpl: Fetch = fetch): ReceiptReader {
  return {
    async read(token, image) {
      let res: Response;
      try {
        res = await fetchImpl(`${apiUrl}/v1/agent/receipt`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ image: image.base64, mediaType: image.mediaType }),
        });
      } catch {
        return { ok: false, error: { kind: "network" } };
      }
      if (!res.ok) {
        return {
          ok: false,
          error: ERRORS[res.status] ?? { kind: "unexpected", status: res.status },
        };
      }
      const reading = toReading(await res.json().catch(() => null));
      return reading
        ? { ok: true, value: reading }
        : { ok: false, error: { kind: "unexpected", status: res.status } };
    },
  };
}

/** Cambios para el formulario de movimiento. Solo llena; la persona revisa y guarda. */
export interface FormPatch {
  /** Pesos enteros para el teclado (COP sin centavos; si no, la persona lo escribe). */
  readonly digits?: string;
  readonly merchant?: string;
  /** 0 hoy, 1 ayer, 2 anteayer. */
  readonly daysAgo?: number;
  /** Fecha más vieja que anteayer. */
  readonly date?: Date;
}

export function patchFromReading(reading: ReceiptReading, now: Date): FormPatch {
  const patch: { digits?: string; merchant?: string; daysAgo?: number; date?: Date } = {};
  const amount = reading.amount;
  if (amount?.currency === "COP") {
    const pesos = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(amount.amount);
    if (pesos?.[1]) {
      // El teclado es de pesos enteros: los centavos se redondean al peso más cercano.
      const cents = Number((pesos[2] ?? "0").padEnd(2, "0"));
      const whole = BigInt(pesos[1]) + (cents >= 50 ? 1n : 0n);
      if (whole > 0n) patch.digits = whole.toString();
    }
  }
  if (reading.merchant) patch.merchant = reading.merchant;
  const at = reading.date ? occurredAtOf(reading.date, now) : null;
  if (at) {
    const today = civilDate(now);
    const day = civilDate(at);
    const days = Math.round(
      (Date.UTC(today.year, today.month - 1, today.day) -
        Date.UTC(day.year, day.month - 1, day.day)) /
        86_400_000,
    );
    if (days <= 2) patch.daysAgo = days;
    else patch.date = at;
  }
  return patch;
}

/** Lector de las pruebas de extremo a extremo: siempre "lee" un mercado de ayer. */
export function e2eReceiptReader(): ReceiptReader {
  return {
    async read() {
      const yesterday = new Date(Date.now() - 86_400_000);
      const day = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
      return {
        ok: true,
        value: { merchant: "Carulla", amount: { amount: "52300.00", currency: "COP" }, date: day },
      };
    },
  };
}
