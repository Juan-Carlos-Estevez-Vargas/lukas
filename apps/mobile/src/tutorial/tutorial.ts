import { sqlitePreferences } from "../data/preferences";
import type { SqlConnection } from "../data/sql";

/** Pasos de "Primeros pasos", en el orden en que se sugieren. */
export const TUTORIAL_STEPS = [
  "movement",
  "budget",
  "goal",
  "recurring",
  "lock",
  "backup",
] as const;
export type TutorialStep = (typeof TUTORIAL_STEPS)[number];

/** Pantallas con un consejo la primera vez que se abren. */
export const TUTORIAL_TIPS = [
  "summary",
  "transactions",
  "budgets",
  "reports",
  "settings",
  "capture",
] as const;
export type TutorialTip = (typeof TUTORIAL_TIPS)[number];

/** Lo que se guarda: pasos marcados a mano, consejos vistos y si se ocultó la lista. */
export interface TutorialState {
  readonly marked: readonly TutorialStep[];
  readonly seenTips: readonly TutorialTip[];
  readonly hidden: boolean;
}

export const EMPTY_TUTORIAL: TutorialState = { marked: [], seenTips: [], hidden: false };

export interface StepStatus {
  readonly step: TutorialStep;
  readonly done: boolean;
}

export interface TutorialProgress {
  readonly steps: readonly StepStatus[];
  readonly done: number;
  readonly total: number;
  /** El primer paso pendiente: el que se destaca. */
  readonly next: TutorialStep | null;
  /** La lista se muestra mientras falte algo y nadie la haya ocultado. */
  readonly visible: boolean;
}

const pick = <T extends string>(values: unknown, allowed: readonly T[]): T[] =>
  Array.isArray(values) ? allowed.filter((a) => values.includes(a)) : [];

/** Lee el estado guardado; un valor dañado cuenta como tutorial nuevo. */
export async function readTutorial(db: SqlConnection): Promise<TutorialState> {
  const raw = await sqlitePreferences(db).get("tutorial.state");
  if (!raw) return EMPTY_TUTORIAL;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    return {
      marked: pick(v.marked, TUTORIAL_STEPS),
      seenTips: pick(v.seenTips, TUTORIAL_TIPS),
      hidden: v.hidden === true,
    };
  } catch {
    return EMPTY_TUTORIAL;
  }
}

async function write(db: SqlConnection, state: TutorialState): Promise<void> {
  await sqlitePreferences(db).set("tutorial.state", JSON.stringify(state));
}

async function update(
  db: SqlConnection,
  change: (s: TutorialState) => TutorialState,
): Promise<TutorialState> {
  const next = change(await readTutorial(db));
  await write(db, next);
  return next;
}

/** Marca un paso que no se deduce de los datos (p. ej. el respaldo, que sale del teléfono). */
export const markStep = (db: SqlConnection, step: TutorialStep) =>
  update(db, (s) => (s.marked.includes(step) ? s : { ...s, marked: [...s.marked, step] }));

export const markTipSeen = (db: SqlConnection, tip: TutorialTip) =>
  update(db, (s) => (s.seenTips.includes(tip) ? s : { ...s, seenTips: [...s.seenTips, tip] }));

export const hideChecklist = (db: SqlConnection) => update(db, (s) => ({ ...s, hidden: true }));

/** "Ver el tutorial otra vez": vuelve la lista y los consejos; lo ya hecho sigue hecho. */
export const restartTutorial = (db: SqlConnection) =>
  update(db, (s) => ({ ...s, seenTips: [], hidden: false }));

const sampleTransactions = async (db: SqlConnection): Promise<string[]> => {
  const raw = await sqlitePreferences(db).get("sample.ids");
  if (!raw) return [];
  try {
    const ids = (JSON.parse(raw) as { transactions?: unknown }).transactions;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
};

const exists = async (db: SqlConnection, sql: string, ...params: string[]) =>
  (await db.get<{ one: number }>(sql, ...params)) !== null;

/**
 * Qué pasos están hechos. Casi todos se deducen de los datos: un gasto o ingreso propio (no los
 * de ejemplo ni los saldos iniciales), un presupuesto, una meta, un recurrente y el bloqueo.
 */
export async function tutorialProgress(
  db: SqlConnection,
  context: { readonly lockOn: boolean },
): Promise<TutorialProgress> {
  const state = await readTutorial(db);
  const samples = await sampleTransactions(db);
  const notSample = samples.length ? ` AND t.id NOT IN (${samples.map(() => "?").join(", ")})` : "";
  const detected: Record<TutorialStep, boolean> = {
    movement: await exists(
      db,
      `SELECT 1 AS one FROM transactions t
         JOIN entries e ON e.transaction_id = t.id
         JOIN categories c ON c.id = e.category_id
        WHERE t.deleted_at IS NULL AND c.kind IN ('income', 'expense')${notSample}
        LIMIT 1`,
      ...samples,
    ),
    budget: await exists(db, "SELECT 1 AS one FROM budgets LIMIT 1"),
    goal: await exists(db, "SELECT 1 AS one FROM goals LIMIT 1"),
    recurring: await exists(db, "SELECT 1 AS one FROM recurring LIMIT 1"),
    lock: context.lockOn,
    backup: false,
  };
  const steps = TUTORIAL_STEPS.map((step) => ({
    step,
    done: detected[step] || state.marked.includes(step),
  }));
  const done = steps.filter((s) => s.done).length;
  return {
    steps,
    done,
    total: steps.length,
    next: steps.find((s) => !s.done)?.step ?? null,
    visible: !state.hidden && done < steps.length,
  };
}
