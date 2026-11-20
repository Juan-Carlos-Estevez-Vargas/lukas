import { type CurrencyCode, isCurrencyCode, Money } from "@lukas/domain";
import { z } from "zod";
import type { AccountView, AgentData, CategoryView, MovementView } from "./data";

export interface ToolContext {
  readonly data: AgentData;
  readonly now: Date;
  /** Genera ids de propuestas; en pruebas se reemplaza por uno fijo. */
  readonly newId?: () => string;
}

/**
 * Una herramienta del agente. Las de lectura solo consultan; las de propuesta validan y devuelven
 * algo que la persona debe aprobar en la app: ninguna escribe.
 */
export interface AgentTool<I extends z.ZodType = z.ZodType, O = unknown> {
  readonly name: string;
  readonly description: string;
  readonly kind: "read" | "proposal";
  readonly input: I;
  run(ctx: ToolContext, input: z.infer<I>): Promise<O>;
}

export class ToolError extends Error {
  constructor(
    readonly code: "not_found" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

const tool = <I extends z.ZodType, O>(t: AgentTool<I, O>): AgentTool<I, O> => t;

// Las fechas son días de Colombia (UTC−5, sin horario de verano).
const OFFSET = "-05:00";
const DAY = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Usa AAAA-MM-DD")
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00${OFFSET}`)), "Fecha inválida")
  .refine(
    (d) => new Date(`${d}T12:00:00${OFFSET}`).toISOString().slice(0, 10) === d,
    "Fecha inválida",
  );
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Usa AAAA-MM");
const CURRENCY = z
  .string()
  .default("COP")
  .refine((c) => isCurrencyCode(c), "Moneda desconocida")
  .transform((c) => c as CurrencyCode);
const AMOUNT = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Monto positivo con punto decimal, sin separadores de miles");
const ID = z.string().min(1).max(100);

const startOf = (day: string) => new Date(`${day}T00:00:00${OFFSET}`);
const dayAfter = (day: string) => new Date(startOf(day).getTime() + 86_400_000);
const dayOf = (d: Date) => new Date(d.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);

const money = (m: Money) => ({ amount: m.toDecimalString(), currency: m.currencyCode });

function range(from: string, to: string) {
  const start = startOf(from);
  const end = dayAfter(to);
  if (end <= start) throw new ToolError("invalid", "`to` debe ser igual o posterior a `from`");
  if (end.getTime() - start.getTime() > 3 * 366 * 86_400_000) {
    throw new ToolError("invalid", "El rango no puede pasar de tres años");
  }
  return { from: start, to: end };
}

async function lookup(data: AgentData) {
  const [accounts, categories] = await Promise.all([data.accounts(), data.categories()]);
  return {
    account: (id: string): AccountView => {
      const a = accounts.find((x) => x.id === id);
      if (!a) throw new ToolError("not_found", `No existe la cuenta ${id}`);
      return a;
    },
    category: (id: string): CategoryView => {
      const c = categories.find((x) => x.id === id);
      if (!c) throw new ToolError("not_found", `No existe la categoría ${id}`);
      return c;
    },
    categoryName: (id: string | null) => categories.find((c) => c.id === id)?.name ?? null,
    accountName: (id: string | null) => accounts.find((a) => a.id === id)?.name ?? null,
  };
}

const sum = (items: readonly MovementView[], currency: CurrencyCode) =>
  items.reduce((t, m) => t.add(m.amount), Money.zero(currency));

// ── Lectura ────────────────────────────────────────────────────────────────────────────────────

export const listAccounts = tool({
  name: "list_accounts",
  description:
    "Cuentas de la persona (efectivo, bancos, billeteras, tarjetas) con su saldo actual.",
  kind: "read",
  input: z.object({ includeArchived: z.boolean().default(false) }),
  async run({ data }, { includeArchived }) {
    return (await data.accounts())
      .filter((a) => includeArchived || !a.archived)
      .map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        archived: a.archived,
        balance: money(a.balance),
      }));
  },
});

export const listCategories = tool({
  name: "list_categories",
  description: "Categorías de gasto o ingreso que la persona tiene activas.",
  kind: "read",
  input: z.object({ kind: z.enum(["expense", "income"]).optional() }),
  async run({ data }, { kind }) {
    return (await data.categories())
      .filter((c) => !c.archived && (!kind || c.kind === kind))
      .map((c) => ({ id: c.id, name: c.name, kind: c.kind }));
  },
});

export const spendingByCategory = tool({
  name: "spending_by_category",
  description:
    "Total gastado (o recibido) por categoría entre dos fechas, de mayor a menor, con su porcentaje. Las fechas son días de Colombia e incluyen ambos extremos.",
  kind: "read",
  input: z.object({
    from: DAY,
    to: DAY,
    kind: z.enum(["expense", "income"]).default("expense"),
    currency: CURRENCY,
  }),
  async run({ data }, input) {
    const names = await lookup(data);
    const items = (await data.movements(range(input.from, input.to))).filter(
      (m) => m.kind === input.kind && m.amount.currencyCode === input.currency,
    );
    const total = sum(items, input.currency);
    const groups = new Map<string | null, MovementView[]>();
    for (const m of items) groups.set(m.categoryId, [...(groups.get(m.categoryId) ?? []), m]);
    const categories = [...groups]
      .map(([categoryId, list]) => ({ categoryId, list, amount: sum(list, input.currency) }))
      .sort((a, b) => b.amount.compare(a.amount))
      .map(({ categoryId, list, amount }) => ({
        categoryId,
        name: names.categoryName(categoryId) ?? "Sin categoría",
        count: list.length,
        // Porcentaje con un decimal, calculado en enteros.
        share: Number((amount.amountMinor * 1000n) / total.amountMinor) / 10,
        ...money(amount),
      }));
    return { from: input.from, to: input.to, kind: input.kind, total: money(total), categories };
  },
});

export const monthSummary = tool({
  name: "month_summary",
  description:
    "Ingresos, gastos y neto de un mes (AAAA-MM) en una moneda, sin contar transferencias.",
  kind: "read",
  input: z.object({ month: MONTH, currency: CURRENCY }),
  async run({ data }, { month, currency }) {
    const [y, m] = month.split("-").map(Number) as [number, number];
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    const items = (
      await data.movements({ from: startOf(`${month}-01`), to: startOf(`${next}-01`) })
    ).filter((x) => x.amount.currencyCode === currency);
    const income = sum(
      items.filter((x) => x.kind === "income"),
      currency,
    );
    const expense = sum(
      items.filter((x) => x.kind === "expense"),
      currency,
    );
    return {
      month,
      income: money(income),
      expense: money(expense),
      net: money(income.subtract(expense)),
      movements: items.filter((x) => x.kind !== "transfer").length,
    };
  },
});

export const listMovements = tool({
  name: "list_movements",
  description:
    "Movimientos entre dos fechas (incluidas), del más reciente al más antiguo, con filtros opcionales por tipo, cuenta, categoría o texto del comercio o nota. Máximo 50.",
  kind: "read",
  input: z.object({
    from: DAY,
    to: DAY,
    kind: z.enum(["expense", "income", "transfer"]).optional(),
    accountId: ID.optional(),
    categoryId: ID.optional(),
    query: z.string().max(80).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  async run({ data }, input) {
    const names = await lookup(data);
    const q = input.query?.trim().toLowerCase();
    const items = (await data.movements(range(input.from, input.to))).filter(
      (m) =>
        (!input.kind || m.kind === input.kind) &&
        (!input.accountId ||
          m.accountId === input.accountId ||
          m.toAccountId === input.accountId) &&
        (!input.categoryId || m.categoryId === input.categoryId) &&
        (!q || `${m.merchant ?? ""} ${m.note ?? ""}`.toLowerCase().includes(q)),
    );
    return {
      total: items.length,
      movements: items.slice(0, input.limit).map((m) => ({
        id: m.id,
        date: dayOf(m.occurredAt),
        kind: m.kind,
        account: names.accountName(m.accountId),
        toAccount: names.accountName(m.toAccountId),
        category: names.categoryName(m.categoryId),
        merchant: m.merchant,
        note: m.note,
        ...money(m.amount),
      })),
    };
  },
});

// ── Propuestas ─────────────────────────────────────────────────────────────────────────────────

export interface Proposal<T extends string = string, P = unknown> {
  readonly id: string;
  readonly type: T;
  /** Frase para la tarjeta de aprobación. */
  readonly summary: string;
  readonly payload: P;
}

const proposalId = (ctx: ToolContext) => ctx.newId?.() ?? crypto.randomUUID();

function parseAmount(text: string, currency: CurrencyCode): Money {
  const parsed = Money.parse(text, currency);
  if (!parsed.ok || parsed.value.isZero())
    throw new ToolError("invalid", "El monto debe ser mayor que cero");
  return parsed.value;
}

export const proposeMovement = tool({
  name: "propose_movement",
  description:
    "Propone registrar un gasto o ingreso. No lo guarda: la persona lo ve en una tarjeta y decide si lo acepta o lo edita.",
  kind: "proposal",
  input: z.object({
    kind: z.enum(["expense", "income"]),
    accountId: ID,
    categoryId: ID,
    amount: AMOUNT,
    date: DAY,
    merchant: z.string().trim().max(80).optional(),
    note: z.string().trim().max(200).optional(),
  }),
  async run(ctx, input) {
    const names = await lookup(ctx.data);
    const account = names.account(input.accountId);
    const category = names.category(input.categoryId);
    if (account.archived) throw new ToolError("invalid", "La cuenta está archivada");
    if (category.archived || category.kind !== input.kind) {
      throw new ToolError("invalid", "La categoría no corresponde al tipo de movimiento");
    }
    const amount = parseAmount(input.amount, account.currency);
    if (startOf(input.date).getTime() > ctx.now.getTime() + 86_400_000) {
      throw new ToolError("invalid", "La fecha no puede ser futura");
    }
    const verb = input.kind === "expense" ? "Gasto" : "Ingreso";
    return {
      id: proposalId(ctx),
      type: "movement",
      summary: `${verb} de ${amount.toDecimalString()} ${amount.currencyCode} en ${category.name} desde ${account.name} el ${input.date}${input.merchant ? ` (${input.merchant})` : ""}`,
      payload: { ...input, amount: money(amount) },
    } satisfies Proposal<"movement">;
  },
});

export const proposeRecategorize = tool({
  name: "propose_recategorize",
  description:
    "Propone cambiar la categoría de un movimiento existente. La persona lo aprueba en la app.",
  kind: "proposal",
  input: z.object({ movementId: ID, categoryId: ID }),
  async run(ctx, input) {
    const names = await lookup(ctx.data);
    const movement = await ctx.data.movement(input.movementId);
    if (!movement) throw new ToolError("not_found", `No existe el movimiento ${input.movementId}`);
    if (movement.kind === "transfer")
      throw new ToolError("invalid", "Las transferencias no tienen categoría");
    const category = names.category(input.categoryId);
    if (category.archived || category.kind !== movement.kind) {
      throw new ToolError("invalid", "La categoría no corresponde al tipo de movimiento");
    }
    if (movement.categoryId === category.id)
      throw new ToolError("invalid", "Ya tiene esa categoría");
    return {
      id: proposalId(ctx),
      type: "recategorize",
      summary: `Mover ${movement.merchant ?? "el movimiento"} del ${dayOf(movement.occurredAt)} de ${names.categoryName(movement.categoryId) ?? "sin categoría"} a ${category.name}`,
      payload: { movementId: movement.id, from: movement.categoryId, to: category.id },
    } satisfies Proposal<"recategorize">;
  },
});

export const proposeBudget = tool({
  name: "propose_budget",
  description:
    "Propone un presupuesto mensual para una categoría de gasto (o para todos los gastos si no se da categoría).",
  kind: "proposal",
  input: z.object({ categoryId: ID.optional(), amount: AMOUNT, currency: CURRENCY }),
  async run(ctx, input) {
    const names = await lookup(ctx.data);
    const category = input.categoryId ? names.category(input.categoryId) : null;
    if (category && (category.archived || category.kind !== "expense")) {
      throw new ToolError("invalid", "Solo se presupuestan categorías de gasto");
    }
    const amount = parseAmount(input.amount, input.currency);
    return {
      id: proposalId(ctx),
      type: "budget",
      summary: `Presupuesto mensual de ${amount.toDecimalString()} ${amount.currencyCode} para ${category?.name ?? "todos los gastos"}`,
      payload: { categoryId: category?.id ?? null, period: "monthly", amount: money(amount) },
    } satisfies Proposal<"budget">;
  },
});

export const TOOLS: readonly AgentTool[] = [
  listAccounts,
  listCategories,
  spendingByCategory,
  monthSummary,
  listMovements,
  proposeMovement,
  proposeRecategorize,
  proposeBudget,
] as readonly AgentTool[];

/** Valida la entrada con el esquema de la herramienta y la ejecuta. */
export async function callTool(ctx: ToolContext, name: string, input: unknown): Promise<unknown> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new ToolError("not_found", `No existe la herramienta ${name}`);
  const parsed = t.input.safeParse(input ?? {});
  if (!parsed.success) {
    throw new ToolError(
      "invalid",
      parsed.error.issues.map((i) => `${i.path.join(".") || "entrada"}: ${i.message}`).join("; "),
    );
  }
  return t.run(ctx, parsed.data);
}
