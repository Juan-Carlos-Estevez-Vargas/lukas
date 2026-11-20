/**
 * Quita datos personales antes de mandarle texto al modelo: números de tarjeta, correos,
 * celulares y números largos (cédulas, cuentas). Los montos ("$1.200.000", "45900") se dejan.
 */
const RULES: readonly [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[correo]"],
  // Tarjetas: 13 a 19 dígitos, con o sin espacios o guiones cada 4.
  [/\b\d{4}(?:[ -]?\d{4}){2}[ -]?\d{1,7}\b/g, "[tarjeta]"],
  // Celulares de Colombia: 3xx xxx xxxx, con o sin +57.
  [/(?:\+?57[ -]?)?\b3\d{2}[ -]?\d{3}[ -]?\d{4}\b/g, "[celular]"],
  // Cédulas y números de cuenta: 8 o más dígitos seguidos que no son un monto con "$".
  [/(?<![$\d.,])\b\d{8,}\b(?![.,]\d)/g, "[número]"],
];

export function redact(text: string): string {
  return RULES.reduce((t, [pattern, label]) => t.replace(pattern, label), text);
}

/**
 * Aplica `redact` a todos los textos de un resultado (objetos y listas). Los ids (`id`, `…Id`) se
 * dejan intactos: el modelo los necesita para proponer cambios y no dicen nada de la persona.
 */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        k === "id" || k.endsWith("Id") ? v : redactDeep(v),
      ]),
    ) as T;
  }
  return value;
}
