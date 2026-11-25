import { type Account, type Debt, Money } from "@lukas/domain";
import { groupOf } from "../accounts/templates";
import { sqliteAccounts } from "../data/ledger-sqlite";
import { sqlitePreferences } from "../data/preferences";
import type { SqlConnection } from "../data/sql";

/** Tasa y pago mínimo que la persona escribe para cada deuda. Se guardan solo en el teléfono. */
export interface DebtTerms {
  readonly annualRateBp: number;
  /** Pago mínimo en unidades menores, como texto (bigint). */
  readonly minPaymentMinor: string;
}

export interface DebtRow {
  readonly account: Account;
  /** Lo que se debe hoy (positivo); cero si la cuenta está al día o a favor. */
  readonly owed: Money;
  readonly terms: DebtTerms | null;
}

const isDebt = (a: Account) => groupOf(a.type) === "debts" || groupOf(a.type) === "cards";

async function readTerms(db: SqlConnection): Promise<Record<string, DebtTerms>> {
  const raw = await sqlitePreferences(db).get("debts.terms");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, DebtTerms> = {};
    for (const [id, v] of Object.entries(parsed)) {
      const t = v as Partial<DebtTerms>;
      if (
        typeof t?.annualRateBp === "number" &&
        Number.isInteger(t.annualRateBp) &&
        t.annualRateBp >= 0 &&
        typeof t.minPaymentMinor === "string" &&
        /^\d+$/.test(t.minPaymentMinor)
      ) {
        out[id] = { annualRateBp: t.annualRateBp, minPaymentMinor: t.minPaymentMinor };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Tarjetas, préstamos y otras deudas activas, con lo que se debe y sus condiciones. */
export async function loadDebts(db: SqlConnection): Promise<DebtRow[]> {
  const repo = sqliteAccounts(db);
  const terms = await readTerms(db);
  const accounts = (await repo.list({ includeArchived: false })).filter(isDebt);
  return Promise.all(
    accounts.map(async (account) => {
      const balance = await repo.balance(account);
      const owed = balance.isNegative() ? balance.negate() : Money.zero(account.currency);
      return { account, owed, terms: terms[account.id] ?? null };
    }),
  );
}

export async function saveTerms(
  db: SqlConnection,
  accountId: string,
  terms: DebtTerms,
): Promise<void> {
  const all = await readTerms(db);
  await sqlitePreferences(db).set("debts.terms", JSON.stringify({ ...all, [accountId]: terms }));
}

/** Tasa escrita por la persona ("28,99" o "28.99") a puntos básicos. `null` si no es válida. */
export function parseRate(text: string): number | null {
  const clean = text.trim().replace(",", ".").replace("%", "");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(clean)) return null;
  const [whole = "0", decimals = ""] = clean.split(".");
  const bp = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  return bp <= 20_000 ? bp : null;
}

export const formatRate = (bp: number): string => {
  const whole = Math.floor(bp / 100);
  const decimals = String(bp % 100).padStart(2, "0");
  return decimals === "00" ? String(whole) : `${whole},${decimals}`;
};

/**
 * Deudas listas para simular: en pesos, con saldo y con condiciones. Las que no las tienen se
 * cuentan aparte para pedírselas a la persona.
 */
export function debtsForPlan(rows: readonly DebtRow[]): {
  readonly debts: Debt[];
  readonly missingTerms: DebtRow[];
} {
  const debts: Debt[] = [];
  const missingTerms: DebtRow[] = [];
  for (const row of rows) {
    if (row.owed.isZero() || row.account.currency !== "COP") continue;
    if (!row.terms) {
      missingTerms.push(row);
      continue;
    }
    debts.push({
      id: row.account.id,
      name: row.account.name,
      balance: row.owed,
      annualRateBp: row.terms.annualRateBp,
      minPayment: Money.ofMinor(BigInt(row.terms.minPaymentMinor), "COP"),
    });
  }
  return { debts, missingTerms };
}
