import type { DomainError } from "@lukas/domain";
import type { MessageKey } from "../i18n/es";

const KNOWN = new Set([
  "balance_not_zero",
  "account_name_required",
  "invalid_day",
  "billing_days_missing",
  "account_archived",
  "invalid_category",
  "not_found",
  "same_account",
  "invalid_fee",
  "currency_mismatch",
  "account_not_found",
  "invalid_amount",
  "split_mismatch",
  "invalid_split",
  "category_name_required",
  "too_deep",
  "rule_pattern_required",
]);

/** Mensaje para un error de dominio de cuentas; los desconocidos caen en uno genérico. */
export const accountErrorKey = (error: DomainError): MessageKey =>
  (KNOWN.has(error.code) ? `accounts.error.${error.code}` : "accounts.error.generic") as MessageKey;
