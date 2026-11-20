import type { AccountType, CurrencyCode, Money } from "@lukas/domain";

/**
 * Lo que las herramientas pueden ver de una persona. Quien la implementa (la API con la sesión y
 * RLS, o los datos de prueba) ya está limitado a esa persona: ninguna herramienta recibe un id de
 * usuario, así que no hay forma de pedir datos de otro.
 */
export interface AgentData {
  accounts(): Promise<readonly AccountView[]>;
  categories(): Promise<readonly CategoryView[]>;
  /** Movimientos en el rango [from, to), del más reciente al más antiguo. */
  movements(range: { readonly from: Date; readonly to: Date }): Promise<readonly MovementView[]>;
  /** Un movimiento por id; `null` si no existe o no es de esta persona. */
  movement(id: string): Promise<MovementView | null>;
}

export interface AccountView {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
  readonly currency: CurrencyCode;
  readonly balance: Money;
  readonly archived: boolean;
}

export interface CategoryView {
  readonly id: string;
  readonly name: string;
  readonly kind: "expense" | "income";
  readonly archived: boolean;
}

export interface MovementView {
  readonly id: string;
  readonly occurredAt: Date;
  readonly kind: "expense" | "income" | "transfer";
  readonly accountId: string;
  /** Solo en transferencias: la cuenta del otro lado. */
  readonly toAccountId: string | null;
  /** `null` en transferencias. */
  readonly categoryId: string | null;
  /** Siempre positivo; el sentido lo da `kind`. */
  readonly amount: Money;
  readonly merchant: string | null;
  readonly note: string | null;
}
