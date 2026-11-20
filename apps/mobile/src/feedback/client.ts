import { cleanFeedback, type FeedbackKind } from "@lukas/domain";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type FeedbackPlatform = "android" | "ios" | "web";

export type FeedbackError =
  | "length"
  | "signed_out"
  | "rate_limited"
  | "unavailable"
  | "network"
  | "unexpected";

export type FeedbackOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: FeedbackError };

export interface FeedbackDraft {
  readonly kind: FeedbackKind;
  readonly message: string;
}

/** Cliente de `POST /v1/feedback`. Limpia el texto (tarjetas incluidas) antes de que salga del teléfono. */
export function createFeedbackClient(
  apiUrl: string,
  context: { readonly appVersion: string; readonly platform: FeedbackPlatform },
  fetchImpl: Fetch = fetch,
) {
  return {
    async send(session: string, draft: FeedbackDraft): Promise<FeedbackOutcome> {
      const message = cleanFeedback(draft.message);
      if (!message) return { ok: false, error: "length" };
      let res: Response;
      try {
        res = await fetchImpl(`${apiUrl}/v1/feedback`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${session}` },
          body: JSON.stringify({ kind: draft.kind, message, ...context }),
        });
      } catch {
        return { ok: false, error: "network" };
      }
      if (res.ok) return { ok: true };
      if (res.status === 401) return { ok: false, error: "signed_out" };
      if (res.status === 422) return { ok: false, error: "length" };
      if (res.status === 429) return { ok: false, error: "rate_limited" };
      if (res.status === 503) return { ok: false, error: "unavailable" };
      return { ok: false, error: "unexpected" };
    },
  };
}

/** Versión de la app tal como la acepta la API (sin espacios ni símbolos raros). */
export function appVersionOf(version: string | undefined): string {
  const clean = (version ?? "").replace(/[^0-9A-Za-z.+-]/g, "").slice(0, 32);
  return clean || "0.0.0";
}
