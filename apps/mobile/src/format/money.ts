import type { Money } from "@lukas/domain";
import type { Locale } from "../i18n/translator";

const SEPARATORS: Record<Locale, { group: string; decimal: string }> = {
  es: { group: ".", decimal: "," },
  en: { group: ",", decimal: "." },
};

const SYMBOLS: Partial<Record<string, string>> = { COP: "$", USD: "US$", EUR: "€" };

/** Lo que se muestra en modo discreto: misma forma, sin revelar la cifra ni su tamaño. */
export const HIDDEN_AMOUNT = "••••";

export interface FormatOptions {
  readonly locale: Locale;
  /** Oculta el monto (modo discreto). */
  readonly discreet?: boolean;
  /** Muestra los centavos aunque sean cero. Por defecto en COP se omiten si son `,00`. */
  readonly alwaysShowCents?: boolean;
}

/**
 * Formatea dinero sin pasar por punto flotante: parte del texto exacto del monto.
 * es: "$ 1.234.567" · "-$ 45.900,50" · en: "$1,234,567".
 */
export function formatMoney(money: Money, options: FormatOptions): string {
  const symbol = SYMBOLS[money.currencyCode] ?? money.currencyCode;
  const space = options.locale === "es" || symbol.length > 1 ? " " : "";
  if (options.discreet) return `${symbol}${space}${HIDDEN_AMOUNT}`;

  const { group, decimal } = SEPARATORS[options.locale];
  const exact = money.toDecimalString();
  const negative = exact.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? exact.slice(1) : exact).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const hideCents =
    !options.alwaysShowCents && money.currencyCode === "COP" && /^0*$/.test(fraction);
  const body = fraction && !hideCents ? `${grouped}${decimal}${fraction}` : grouped;
  return `${negative ? "-" : ""}${symbol}${space}${body}`;
}
