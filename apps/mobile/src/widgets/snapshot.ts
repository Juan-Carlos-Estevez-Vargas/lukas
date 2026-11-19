import type { Money } from "@lukas/domain";
import { formatMoney } from "../format/money";
import type { Locale } from "../i18n/translator";

/** Lo que muestran los widgets. Se calcula en la app y se guarda para cuando Android los pinte. */
export interface WidgetSnapshot {
  readonly label: string;
  /** Monto ya formateado, o `••••` si la app está protegida o en modo discreto. */
  readonly amount: string;
  readonly hint: string;
  readonly negative: boolean;
}

/** Categorías del widget de gasto rápido: un toque abre el registro con la categoría puesta. */
export const QUICK_CATEGORIES = [
  { id: "default.mercado", icon: "🛒" },
  { id: "default.transporte", icon: "🚌" },
  { id: "default.restaurantes", icon: "🍔" },
] as const;

/** Enlace profundo al registro rápido. */
export function quickEntryUri(kind: "expense" | "income", categoryId?: string): string {
  const params = new URLSearchParams({ kind });
  if (categoryId) params.set("category", categoryId);
  return `lukas://movement/new?${params}`;
}

/**
 * El widget se ve sin desbloquear la app: si hay PIN o modo discreto, no muestra el monto.
 */
export function availableSnapshot(
  available: Money,
  options: {
    readonly locale: Locale;
    readonly hidden: boolean;
    readonly label: string;
    readonly hint: string;
  },
): WidgetSnapshot {
  return {
    label: options.label,
    amount: formatMoney(available, { locale: options.locale, discreet: options.hidden }),
    hint: options.hint,
    negative: !options.hidden && available.isNegative(),
  };
}

export const EMPTY_SNAPSHOT = (label: string, hint: string): WidgetSnapshot => ({
  label,
  amount: "—",
  hint,
  negative: false,
});

/** Lee lo guardado; cualquier cosa rara se descarta. */
export function parseSnapshot(text: string | null): WidgetSnapshot | null {
  if (!text) return null;
  try {
    const v: unknown = JSON.parse(text);
    if (typeof v !== "object" || v === null) return null;
    const { label, amount, hint, negative } = v as Record<string, unknown>;
    if (typeof label !== "string" || typeof amount !== "string" || typeof hint !== "string") {
      return null;
    }
    return { label, amount, hint, negative: negative === true };
  } catch {
    return null;
  }
}
