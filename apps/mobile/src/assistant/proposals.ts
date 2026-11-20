import { DomainError, Money, type Result } from "@lukas/domain";
import type { Clock } from "../accounts/accounts";
import { civilDate } from "../accounts/credit-card";
import { createBudget } from "../budgets/budgets";
import type { SqlConnection } from "../data/sql";
import { recategorize, recordMovement } from "../movements/movements";
import { parseCivil } from "../recurring/recurring";
import type { Proposal, WireMoney } from "./stream";

const toMoney = (m: WireMoney): Result<Money, DomainError> => Money.parse(m.amount, m.currency);

/** El día de la propuesta a mediodía local, o ahora si es hoy. Nunca en el futuro. */
export function occurredAtOf(day: string, now: Date): Date | null {
  const d = parseCivil(day);
  if (!d) return null;
  const today = civilDate(now);
  if (d.year === today.year && d.month === today.month && d.day === today.day) return now;
  const at = new Date(d.year, d.month - 1, d.day, 12);
  return at.getTime() > now.getTime() ? null : at;
}

/**
 * Guarda una propuesta que la persona aceptó. Es el único camino por el que algo del asistente
 * llega a la base: el chat solo muestra tarjetas.
 */
export async function acceptProposal(
  db: SqlConnection,
  proposal: Proposal,
  clock: Clock,
): Promise<Result<true, DomainError>> {
  switch (proposal.type) {
    case "movement": {
      const p = proposal.payload;
      const amount = toMoney(p.amount);
      if (!amount.ok) return amount;
      const occurredAt = occurredAtOf(p.date, clock.now());
      if (!occurredAt) return { ok: false, error: new DomainError("invalid_date", p.date) };
      const res = await recordMovement(
        db,
        {
          kind: p.kind,
          accountId: p.accountId,
          categoryId: p.categoryId,
          amount: amount.value,
          occurredAt,
          merchant: p.merchant,
          note: p.note,
          source: "manual",
        },
        clock,
      );
      return res.ok ? { ok: true, value: true } : res;
    }
    case "recategorize":
      return recategorize(db, proposal.payload.movementId, proposal.payload.to, clock);
    case "budget": {
      const amount = toMoney(proposal.payload.amount);
      if (!amount.ok) return amount;
      const res = await createBudget(
        db,
        {
          categoryId: proposal.payload.categoryId,
          period: "monthly",
          amount: amount.value,
          rollover: false,
        },
        civilDate(clock.now()),
        clock,
      );
      return res.ok ? { ok: true, value: true } : res;
    }
  }
}

/** Monto que se muestra con formato en la tarjeta (el resumen del modelo viene sin formato). */
export function proposalAmount(proposal: Proposal): Money | null {
  if (proposal.type === "recategorize") return null;
  const res = toMoney(proposal.payload.amount);
  return res.ok ? res.value : null;
}

export interface EditTarget {
  readonly pathname: string;
  readonly params: Readonly<Record<string, string>>;
}

/** Pesos enteros para el teclado del formulario; otra moneda o centavos se escriben a mano. */
const wholePesos = (m: WireMoney): string | null => {
  const match = /^(\d+)(?:\.0+)?$/.exec(m.amount);
  return m.currency === "COP" && match?.[1] ? match[1] : null;
};

/** Formulario que abre "Editar", ya lleno con lo que propuso el asistente. */
export function editTarget(proposal: Proposal): EditTarget {
  switch (proposal.type) {
    case "movement": {
      const p = proposal.payload;
      const amount = wholePesos(p.amount);
      return {
        pathname: "/movement/new",
        params: {
          kind: p.kind,
          category: p.categoryId,
          account: p.accountId,
          ...(amount ? { amount } : {}),
          ...(p.merchant ? { merchant: p.merchant } : {}),
          ...(p.note ? { note: p.note } : {}),
        },
      };
    }
    case "recategorize":
      return { pathname: "/movement/[id]", params: { id: proposal.payload.movementId } };
    case "budget": {
      const amount = wholePesos(proposal.payload.amount);
      return {
        pathname: "/budgets/new",
        params: {
          ...(amount ? { amount } : {}),
          ...(proposal.payload.categoryId ? { category: proposal.payload.categoryId } : {}),
        },
      };
    }
  }
}
