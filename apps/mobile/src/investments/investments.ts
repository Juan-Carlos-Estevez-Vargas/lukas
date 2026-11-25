import {
  type CivilDate,
  type CurrencyCode,
  isCurrencyCode,
  isInvestmentKind,
  isValidCivil,
  Money,
  type Position,
  validUnits,
} from "@lukas/domain";
import { sqlitePreferences } from "../data/preferences";
import type { SqlConnection } from "../data/sql";

/**
 * Posiciones de inversión (FIN-601). Se guardan solo en el teléfono, en las preferencias, y viajan
 * en el respaldo cifrado. El precio lo actualiza la persona: Lukas no consulta cotizaciones.
 */

interface StoredPosition {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly units: string;
  readonly currency: string;
  readonly unitPriceMinor: string;
  readonly investedMinor: string;
  readonly openedOn: string;
}

const KEY = "investments.positions" as const;
const MINOR = /^\d+$/;

const civilText = (d: CivilDate) =>
  `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

export function parseCivil(text: string): CivilDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const d = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  return isValidCivil(d) ? d : null;
}

function fromStored(s: Partial<StoredPosition>): Position | null {
  if (
    typeof s.id !== "string" ||
    typeof s.name !== "string" ||
    !isInvestmentKind(s.kind) ||
    typeof s.units !== "string" ||
    !validUnits(s.units) ||
    typeof s.currency !== "string" ||
    !isCurrencyCode(s.currency) ||
    typeof s.unitPriceMinor !== "string" ||
    !MINOR.test(s.unitPriceMinor) ||
    typeof s.investedMinor !== "string" ||
    !MINOR.test(s.investedMinor) ||
    typeof s.openedOn !== "string"
  ) {
    return null;
  }
  const openedOn = parseCivil(s.openedOn);
  if (!openedOn) return null;
  const currency: CurrencyCode = s.currency;
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    units: s.units,
    unitPrice: Money.ofMinor(BigInt(s.unitPriceMinor), currency),
    invested: Money.ofMinor(BigInt(s.investedMinor), currency),
    openedOn,
  };
}

const toStored = (p: Position): StoredPosition => ({
  id: p.id,
  name: p.name,
  kind: p.kind,
  units: p.units,
  currency: p.invested.currencyCode,
  unitPriceMinor: p.unitPrice.amountMinor.toString(),
  investedMinor: p.invested.amountMinor.toString(),
  openedOn: civilText(p.openedOn),
});

export async function listPositions(db: SqlConnection): Promise<Position[]> {
  const raw = await sqlitePreferences(db).get(KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((s: Partial<StoredPosition>) => fromStored(s) ?? []);
  } catch {
    return [];
  }
}

const write = (db: SqlConnection, positions: readonly Position[]) =>
  sqlitePreferences(db).set(KEY, JSON.stringify(positions.map(toStored)));

export type PositionProblem = "name" | "units" | "price" | "invested" | "currency";

/** Revisa una posición antes de guardarla. `null` si está bien. */
export function positionProblem(p: Position): PositionProblem | null {
  if (p.name.trim().length === 0 || p.name.length > 60) return "name";
  if (!validUnits(p.units)) return "units";
  if (p.unitPrice.isNegative()) return "price";
  if (p.invested.isNegative() || p.invested.isZero()) return "invested";
  if (p.unitPrice.currencyCode !== p.invested.currencyCode) return "currency";
  return null;
}

/** Crea o reemplaza una posición por su id. */
export async function savePosition(db: SqlConnection, position: Position): Promise<void> {
  const problem = positionProblem(position);
  if (problem) throw new RangeError(`Posición inválida: ${problem}`);
  const clean = { ...position, name: position.name.trim() };
  const all = await listPositions(db);
  const i = all.findIndex((p) => p.id === clean.id);
  await write(db, i === -1 ? [...all, clean] : all.map((p) => (p.id === clean.id ? clean : p)));
}

export async function removePosition(db: SqlConnection, id: string): Promise<void> {
  await write(
    db,
    (await listPositions(db)).filter((p) => p.id !== id),
  );
}

/**
 * Unidades escritas por la persona a texto decimal; `null` si no sirven. Con coma, la coma es el
 * decimal ("1.234,5"); sin coma, el punto lo es ("0.0035"), como se ven las cripto en los exchanges.
 */
export function parseUnits(text: string): string | null {
  const t = text.trim();
  const units = t.includes(",") ? t.replace(/\./g, "").replace(/,/g, ".") : t;
  return /^\d+(\.\d+)?$/.test(units) && validUnits(units) ? units : null;
}

/** Precio por unidad en pesos, con centavos opcionales ("12.345,67"). */
export function parseUnitPrice(text: string): Money | null {
  const clean = text.trim().replace(/\./g, "").replace(/,/g, ".");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const res = Money.parse(clean, "COP");
  return res.ok ? res.value : null;
}

/** Puntos básicos con signo a texto de porcentaje: −150 → "-1,5 %". */
export function formatPercentBp(bp: number): string {
  const abs = Math.abs(bp);
  const whole = Math.floor(abs / 100);
  const decimals = String(abs % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return `${bp < 0 ? "-" : ""}${whole}${decimals ? `,${decimals}` : ""} %`;
}
