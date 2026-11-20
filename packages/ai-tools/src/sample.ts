import { type CurrencyCode, Money } from "@lukas/domain";
import type { AccountView, CategoryView, MovementView } from "./data";
import { memoryData } from "./memory";

const cop = (pesos: number, currency: CurrencyCode = "COP") =>
  Money.ofMinor(BigInt(pesos) * 100n, currency);
// Mediodía de Colombia de ese día.
const on = (day: string) => new Date(`${day}T12:00:00-05:00`);

/** Datos inventados de una persona: sirven a las pruebas y al servidor MCP local. */
export function sampleData() {
  const accounts: AccountView[] = [
    {
      id: "acc-nequi",
      name: "Nequi",
      type: "digital_wallet",
      currency: "COP",
      balance: cop(350_000),
      archived: false,
    },
    {
      id: "acc-banco",
      name: "Bancolombia",
      type: "bank",
      currency: "COP",
      balance: cop(2_400_000),
      archived: false,
    },
    {
      id: "acc-visa",
      name: "Visa",
      type: "credit_card",
      currency: "COP",
      balance: cop(-480_000),
      archived: false,
    },
    {
      id: "acc-usd",
      name: "Cuenta en dólares",
      type: "bank",
      currency: "USD",
      balance: cop(300, "USD"),
      archived: false,
    },
    {
      id: "acc-vieja",
      name: "Davivienda vieja",
      type: "bank",
      currency: "COP",
      balance: cop(0),
      archived: true,
    },
  ];
  const categories: CategoryView[] = [
    { id: "cat-mercado", name: "Mercado", kind: "expense", archived: false },
    { id: "cat-restaurantes", name: "Restaurantes y domicilios", kind: "expense", archived: false },
    { id: "cat-transporte", name: "Transporte", kind: "expense", archived: false },
    { id: "cat-entretenimiento", name: "Entretenimiento", kind: "expense", archived: false },
    { id: "cat-salario", name: "Salario", kind: "income", archived: false },
    { id: "cat-vieja", name: "Gimnasio", kind: "expense", archived: true },
  ];
  let n = 0;
  const move = (
    day: string,
    kind: MovementView["kind"],
    accountId: string,
    categoryId: string | null,
    pesos: number,
    merchant: string | null,
    extra: Partial<MovementView> = {},
  ): MovementView => ({
    id: `mov-${++n}`,
    occurredAt: on(day),
    kind,
    accountId,
    toAccountId: null,
    categoryId,
    amount: cop(pesos),
    merchant,
    note: null,
    ...extra,
  });
  const movements: MovementView[] = [
    move("2026-10-01", "income", "acc-banco", "cat-salario", 4_500_000, "Empresa SAS"),
    move("2026-10-03", "expense", "acc-banco", "cat-mercado", 230_000, "Carulla"),
    move("2026-10-05", "expense", "acc-visa", "cat-restaurantes", 45_900, "Rappi"),
    move("2026-10-12", "expense", "acc-nequi", "cat-transporte", 18_000, "Uber"),
    move("2026-10-14", "expense", "acc-visa", "cat-entretenimiento", 44_900, "Netflix"),
    move("2026-10-20", "expense", "acc-banco", "cat-mercado", 180_000, "Éxito", {
      note: "mercado quincena",
    }),
    move("2026-10-25", "transfer", "acc-banco", null, 500_000, null, { toAccountId: "acc-nequi" }),
    move("2026-10-31", "expense", "acc-nequi", "cat-restaurantes", 32_000, "El Corral"),
    move("2026-11-01", "income", "acc-banco", "cat-salario", 4_500_000, "Empresa SAS"),
    move("2026-11-02", "expense", "acc-banco", "cat-mercado", 210_000, "Carulla"),
    move("2026-11-03", "expense", "acc-usd", "cat-entretenimiento", 12, "Steam", {
      amount: cop(12, "USD"),
    }),
  ];
  return memoryData({ accounts, categories, movements });
}
