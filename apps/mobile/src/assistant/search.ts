import { toWireMoney, type WireMoney } from "./stream";

/** Un movimiento encontrado por significado. */
export interface SearchResult {
  readonly id: string;
  readonly date: Date;
  readonly merchant: string | null;
  readonly description: string;
  readonly category: string | null;
  readonly amount: WireMoney | null;
}

export type SearchError =
  | "signed_out"
  | "premium"
  | "quota"
  | "unavailable"
  | "network"
  | "unexpected";

export type SearchOutcome =
  | { readonly ok: true; readonly value: readonly SearchResult[] }
  | { readonly ok: false; readonly error: SearchError };

export interface SearchClient {
  search(token: string, query: string): Promise<SearchOutcome>;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const ERRORS: Record<number, SearchError> = {
  401: "signed_out",
  402: "premium",
  429: "quota",
  503: "unavailable",
};

const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);

/** Valida un resultado: lo que llega de la red no se da por bueno. */
export function toResult(v: unknown): SearchResult | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const id = text(o.id, 64);
  const date = typeof o.date === "string" ? new Date(o.date) : null;
  if (!id || !date || Number.isNaN(date.getTime())) return null;
  return {
    id,
    date,
    merchant: text(o.merchant, 80),
    description: text(o.description, 200) ?? "",
    category: text(o.category, 120),
    amount: o.amount === null ? null : toWireMoney(o.amount),
  };
}

/** Cliente de `POST /v1/agent/search`. */
export function createSearchClient(apiUrl: string, fetchImpl: Fetch = fetch): SearchClient {
  return {
    async search(token, query) {
      let res: Response;
      try {
        res = await fetchImpl(`${apiUrl}/v1/agent/search`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ query: query.trim().slice(0, 200) }),
        });
      } catch {
        return { ok: false, error: "network" };
      }
      if (!res.ok) return { ok: false, error: ERRORS[res.status] ?? "unexpected" };
      const body = (await res.json().catch(() => null)) as { results?: unknown } | null;
      if (!body || !Array.isArray(body.results)) return { ok: false, error: "unexpected" };
      return {
        ok: true,
        value: body.results.map(toResult).filter((r): r is SearchResult => r !== null),
      };
    },
  };
}
