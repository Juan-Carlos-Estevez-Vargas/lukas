import { isLegalDocument, LEGAL_VERSIONS, type LegalDocument } from "@lukas/domain";
import { sqlitePreferences } from "../data/preferences";
import type { SqlConnection } from "../data/sql";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Cliente de `/v1/legal/consents`. `null` / `false` si no hay red o la API falla. */
export function createConsentClient(apiUrl: string, fetchImpl: Fetch = fetch) {
  const url = `${apiUrl}/v1/legal/consents`;
  const pendingOf = async (res: Response): Promise<LegalDocument[] | null> => {
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { pending?: unknown } | null;
    if (!body || !Array.isArray(body.pending)) return null;
    return body.pending.filter(
      (d): d is LegalDocument => typeof d === "string" && isLegalDocument(d),
    );
  };
  return {
    async pending(session: string): Promise<LegalDocument[] | null> {
      try {
        return await pendingOf(
          await fetchImpl(url, { headers: { authorization: `Bearer ${session}` } }),
        );
      } catch {
        return null;
      }
    },
    async accept(session: string): Promise<boolean> {
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${session}` },
          body: JSON.stringify(LEGAL_VERSIONS),
        });
        return (await pendingOf(res))?.length === 0;
      } catch {
        return false;
      }
    },
  };
}

export type ConsentClient = ReturnType<typeof createConsentClient>;

const current = () => JSON.stringify(LEGAL_VERSIONS);

/** Lo que la persona aceptó en este teléfono (al registrarse), para enviarlo con la sesión. */
export async function rememberAcceptance(db: SqlConnection): Promise<void> {
  await sqlitePreferences(db).set("legal.accepted", current());
}

export async function acceptedHere(db: SqlConnection): Promise<boolean> {
  return (await sqlitePreferences(db).get("legal.accepted")) === current();
}

/**
 * Qué hacer al entrar con sesión:
 * - `ok`: la API ya tiene la autorización vigente (o la acaba de recibir de este teléfono).
 * - `ask`: hay que mostrar los documentos y pedir que los acepte (p. ej. cambió la versión).
 * - `offline`: no se pudo preguntar; no se bloquea la app y se reintenta al volver.
 */
export async function resolveConsent(
  db: SqlConnection,
  client: ConsentClient,
  session: string,
): Promise<"ok" | "ask" | "offline"> {
  const pending = await client.pending(session);
  if (pending === null) return "offline";
  if (pending.length === 0) return "ok";
  if (!(await acceptedHere(db))) return "ask";
  return (await client.accept(session)) ? "ok" : "offline";
}

/** La persona aceptó en la pantalla de documentos: se guarda aquí y se envía. */
export async function acceptNow(
  db: SqlConnection,
  client: ConsentClient,
  session: string,
): Promise<boolean> {
  await rememberAcceptance(db);
  return client.accept(session);
}
