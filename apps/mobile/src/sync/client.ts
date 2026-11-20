import type { Operation, PullResponse, PushResponse } from "@lukas/sync";

/** Puerto hacia `/v1/sync`. En pruebas se reemplaza por un servidor en memoria. */
export interface SyncApi {
  push(ops: readonly Operation[]): Promise<PushResponse>;
  pull(cursor: string): Promise<PullResponse>;
}

export class SyncHttpError extends Error {
  constructor(readonly status: number) {
    super(`La sincronización respondió ${status}`);
    this.name = "SyncHttpError";
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export const createSyncApi = (
  baseUrl: string,
  token: string,
  fetchImpl: Fetch = fetch,
): SyncApi => {
  const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new SyncHttpError(res.status);
    return (await res.json()) as T;
  };
  return {
    push: (ops) =>
      call<PushResponse>("/v1/sync/push", { method: "POST", body: JSON.stringify({ ops }) }),
    pull: (cursor) => call<PullResponse>(`/v1/sync/pull?cursor=${encodeURIComponent(cursor)}`),
  };
};
