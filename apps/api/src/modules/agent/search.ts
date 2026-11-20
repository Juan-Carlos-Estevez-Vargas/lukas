import { withUser } from "@lukas/db";
import { isCurrencyCode, Money } from "@lukas/domain";
import { type EmbeddingModel, embed, embedMany } from "ai";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { TablesRelationalConfig } from "drizzle-orm/relations";

/** Movimientos que se indexan por petición: acota el costo de la primera búsqueda. */
export const INDEX_BATCH = 100;
/** Similitud mínima (coseno) para mostrar un resultado. */
export const MIN_SCORE = 0.35;

export interface SearchHit {
  readonly id: string;
  readonly date: string;
  readonly merchant: string | null;
  readonly description: string;
  readonly category: string | null;
  /** Monto en texto decimal (gasto o ingreso); `null` en transferencias. */
  readonly amount: { readonly amount: string; readonly currency: string } | null;
  readonly score: number;
}

type Db<
  Q extends PgQueryResultHKT,
  F extends Record<string, unknown>,
  S extends TablesRelationalConfig,
> = PgDatabase<Q, F, S>;

const rowsOf = <T>(result: unknown): T[] =>
  Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []);

/**
 * Texto que representa un movimiento. Es solo un dato para el modelo de embeddings: aunque un
 * comercio traiga "instrucciones", aquí nada se ejecuta ni se interpreta.
 */
export const contentOf = (r: {
  merchant: string | null;
  description: string;
  categories: string | null;
}) =>
  [r.merchant, r.description, r.categories ? `Categoría: ${r.categories}` : null]
    .filter((p): p is string => Boolean(p?.trim()))
    .join(" · ")
    .slice(0, 500);

async function hash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const vectorLiteral = (v: readonly number[]) => `[${v.map((x) => Number(x).toFixed(6)).join(",")}]`;

interface PendingRow {
  id: string;
  merchant: string | null;
  description: string;
  categories: string | null;
  content_hash: string | null;
}

/** Calcula los embeddings que faltan o quedaron viejos. Devuelve cuántos y los tokens usados. */
export async function indexPending<
  Q extends PgQueryResultHKT,
  F extends Record<string, unknown>,
  S extends TablesRelationalConfig,
>(db: Db<Q, F, S>, userId: string, model: EmbeddingModel, batch = INDEX_BATCH) {
  const rows = await withUser(db, userId, async (tx) =>
    rowsOf<PendingRow>(
      await tx.execute(sql`
        SELECT t.id, t.merchant, t.description, te.content_hash,
          string_agg(DISTINCT c.name, ', ') AS categories
        FROM app.transactions t
        LEFT JOIN app.entries e ON e.transaction_id = t.id AND e.category_id IS NOT NULL
        LEFT JOIN app.categories c ON c.id = e.category_id
        LEFT JOIN app.transaction_embeddings te ON te.transaction_id = t.id
        WHERE t.deleted_at IS NULL AND t.user_id = ${userId}
        GROUP BY t.id, te.content_hash
        ORDER BY max(t.occurred_at) DESC
        LIMIT 2000
      `),
    ),
  );
  const pending: { id: string; text: string; hash: string }[] = [];
  for (const r of rows) {
    if (pending.length >= batch) break;
    const text = contentOf(r);
    if (!text) continue;
    const h = await hash(text);
    if (h !== r.content_hash) pending.push({ id: r.id, text, hash: h });
  }
  if (pending.length === 0) return { indexed: 0, tokens: 0 };
  const { embeddings, usage } = await embedMany({
    model,
    values: pending.map((p) => p.text),
    maxRetries: 1,
  });
  await withUser(db, userId, async (tx) => {
    for (const [i, p] of pending.entries()) {
      const vector = embeddings[i];
      if (!vector) continue;
      await tx.execute(sql`
        INSERT INTO app.transaction_embeddings (transaction_id, user_id, embedding, content_hash)
        VALUES (${p.id}, ${userId}, ${vectorLiteral(vector)}::vector, ${p.hash})
        ON CONFLICT (transaction_id) DO UPDATE
          SET embedding = excluded.embedding, content_hash = excluded.content_hash, updated_at = now()
      `);
    }
  });
  return { indexed: pending.length, tokens: usage.tokens };
}

interface HitRow {
  id: string;
  occurred_at: string | Date;
  merchant: string | null;
  description: string;
  category: string | null;
  amount_minor: string | null;
  currency: string | null;
  score: string | number;
}

/** Busca por significado entre los movimientos de la persona (RLS además del filtro). */
export async function semanticSearch<
  Q extends PgQueryResultHKT,
  F extends Record<string, unknown>,
  S extends TablesRelationalConfig,
>(
  db: Db<Q, F, S>,
  userId: string,
  model: EmbeddingModel,
  query: string,
  options: { limit?: number; minScore?: number } = {},
) {
  const { embedding, usage } = await embed({ model, value: query, maxRetries: 1 });
  const q = vectorLiteral(embedding);
  const rows = await withUser(db, userId, async (tx) =>
    rowsOf<HitRow>(
      await tx.execute(sql`
        SELECT t.id, t.occurred_at, t.merchant, t.description,
          1 - (te.embedding <=> ${q}::vector) AS score,
          (SELECT string_agg(c.name, ', ') FROM app.entries e JOIN app.categories c ON c.id = e.category_id
             WHERE e.transaction_id = t.id) AS category,
          (SELECT sum(e.amount_minor)::text FROM app.entries e
             WHERE e.transaction_id = t.id AND e.category_id IS NOT NULL) AS amount_minor,
          (SELECT max(e.currency) FROM app.entries e
             WHERE e.transaction_id = t.id AND e.category_id IS NOT NULL) AS currency
        FROM app.transaction_embeddings te
        JOIN app.transactions t ON t.id = te.transaction_id
        WHERE te.user_id = ${userId} AND t.deleted_at IS NULL
        ORDER BY te.embedding <=> ${q}::vector
        LIMIT ${options.limit ?? 20}
      `),
    ),
  );
  const hits: SearchHit[] = rows
    .map((r) => ({
      id: r.id,
      date: new Date(r.occurred_at).toISOString(),
      merchant: r.merchant,
      description: r.description,
      category: r.category,
      amount:
        r.amount_minor && r.currency && isCurrencyCode(r.currency)
          ? {
              amount: Money.ofMinor(BigInt(r.amount_minor), r.currency).toDecimalString(),
              currency: r.currency,
            }
          : null,
      score: Math.round(Number(r.score) * 1000) / 1000,
    }))
    .filter((h) => h.score >= (options.minScore ?? MIN_SCORE));
  return { hits, tokens: usage.tokens };
}

/** Puerto de búsqueda que usa la ruta; en producción, Postgres con pgvector. */
export interface SearchStore {
  index(userId: string, model: EmbeddingModel): Promise<{ indexed: number; tokens: number }>;
  find(
    userId: string,
    model: EmbeddingModel,
    query: string,
  ): Promise<{ hits: SearchHit[]; tokens: number }>;
}

export function postgresSearch<
  Q extends PgQueryResultHKT,
  F extends Record<string, unknown>,
  S extends TablesRelationalConfig,
>(db: Db<Q, F, S>): SearchStore {
  return {
    index: (userId, model) => indexPending(db, userId, model),
    find: (userId, model, query) => semanticSearch(db, userId, model, query),
  };
}
