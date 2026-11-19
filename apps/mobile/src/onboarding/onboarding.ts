import { type Account, createAccount, type Entry, Money, type Transaction } from "@lukas/domain";
import { recordOpeningBalance } from "../accounts/accounts";
import { ACCOUNT_TEMPLATES, type AccountTemplate } from "../accounts/templates";
import { sqliteRepositories } from "../data/ledger-sqlite";
import { sqlitePreferences } from "../data/preferences";
import type { SqlConnection } from "../data/sql";

/** En el onboarding se ofrecen las más comunes; el resto, desde Cuentas. */
export const ONBOARDING_TEMPLATES: readonly AccountTemplate[] = (
  ["cash", "nequi", "daviplata", "bancolombia"] as const
).flatMap((key) => ACCOUNT_TEMPLATES.filter((t) => t.key === key));

export interface OnboardingInput {
  readonly template: AccountTemplate;
  /** Saldo actual de la cuenta, en COP. `null` o cero si se deja para después. */
  readonly openingBalance: Money | null;
  readonly sampleData: boolean;
}

export interface OnboardingDeps {
  readonly newId: () => string;
  readonly now: () => Date;
}

interface SampleIds {
  readonly accounts: string[];
  readonly categories: string[];
  readonly transactions: string[];
}

async function insertCategory(
  db: SqlConnection,
  id: string,
  name: string,
  kind: "income" | "expense" | "equity",
  now: Date,
  isSystem = false,
): Promise<void> {
  await db.run(
    `INSERT INTO categories (id, name, kind, is_system, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    name,
    kind,
    isSystem ? 1 : 0,
    now.toISOString(),
    now.toISOString(),
  );
}

function movement(
  deps: OnboardingDeps,
  description: string,
  accountId: string,
  categoryId: string,
  accountAmount: Money,
  occurredAt: Date,
): Transaction {
  const now = deps.now();
  const entries: Entry[] = [
    { id: deps.newId(), target: { accountId }, amount: accountAmount },
    { id: deps.newId(), target: { categoryId }, amount: accountAmount.negate() },
  ];
  return {
    id: deps.newId(),
    occurredAt,
    description,
    merchant: null,
    notes: null,
    status: "cleared",
    source: "manual",
    entries,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

async function createSampleData(db: SqlConnection, deps: OnboardingDeps): Promise<SampleIds> {
  const { accounts, transactions } = sqliteRepositories(db);
  const now = deps.now();
  const res = createAccount(
    { name: "Cuenta de ejemplo", type: "bank", currency: "COP" },
    deps.newId(),
    now,
  );
  if (!res.ok) throw res.error;
  await accounts.save(res.value);
  const [salary, groceries, transport] = [deps.newId(), deps.newId(), deps.newId()];
  await insertCategory(db, salary, "Salario (ejemplo)", "income", now);
  await insertCategory(db, groceries, "Mercado (ejemplo)", "expense", now);
  await insertCategory(db, transport, "Transporte (ejemplo)", "expense", now);
  const day = (n: number) => new Date(now.getTime() - n * 86_400_000);
  const cop = (pesos: bigint) => Money.ofMinor(pesos * 100n, "COP");
  const samples = [
    movement(deps, "Pago de nómina", res.value.id, salary, cop(2_800_000n), day(6)),
    movement(deps, "Mercado del mes", res.value.id, groceries, cop(-385_400n), day(3)),
    movement(deps, "Recarga TuLlave", res.value.id, transport, cop(-50_000n), day(1)),
  ];
  for (const t of samples) await transactions.save(t);
  return {
    accounts: [res.value.id],
    categories: [salary, groceries, transport],
    transactions: samples.map((t) => t.id),
  };
}

/**
 * Último paso del onboarding: crea la primera cuenta con su saldo inicial y, si se pidió, datos de
 * ejemplo. Todo en una sola transacción: si algo falla, no queda una app a medio configurar.
 */
export async function completeOnboarding(
  db: SqlConnection,
  input: OnboardingInput,
  deps: OnboardingDeps,
): Promise<Account> {
  let created: Account | undefined;
  await db.transaction(async (tx) => {
    const { accounts } = sqliteRepositories(tx);
    const prefs = sqlitePreferences(tx);
    const now = deps.now();
    const res = createAccount(
      {
        name: input.template.name,
        type: input.template.type,
        currency: "COP",
        institution: input.template.institution,
      },
      deps.newId(),
      now,
    );
    if (!res.ok) throw res.error;
    await accounts.save(res.value);

    if (input.openingBalance) {
      await recordOpeningBalance(tx, res.value, input.openingBalance, deps);
    }
    if (input.sampleData) {
      await prefs.set("sample.ids", JSON.stringify(await createSampleData(tx, deps)));
    }
    await prefs.set("onboarding.completedAt", now.toISOString());
    created = res.value;
  });
  if (!created) throw new Error("El onboarding no creó la cuenta");
  return created;
}

export async function isOnboarded(db: SqlConnection): Promise<boolean> {
  return (await sqlitePreferences(db).get("onboarding.completedAt")) !== null;
}

/** Borra los datos de ejemplo sin tocar nada de lo que el usuario registró. */
export async function removeSampleData(db: SqlConnection): Promise<void> {
  await db.transaction(async (tx) => {
    const prefs = sqlitePreferences(tx);
    const raw = await prefs.get("sample.ids");
    if (!raw) return;
    const ids = JSON.parse(raw) as SampleIds;
    for (const id of ids.transactions) await tx.run("DELETE FROM transactions WHERE id = ?", id);
    for (const id of ids.accounts) await tx.run("DELETE FROM accounts WHERE id = ?", id);
    for (const id of ids.categories) await tx.run("DELETE FROM categories WHERE id = ?", id);
    await prefs.remove("sample.ids");
  });
}
