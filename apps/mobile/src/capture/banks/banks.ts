import { AMOUNT, type BankParser } from "./rules";

const re = (source: string) => new RegExp(source, "i");

// Lo que sigue al comercio en los avisos: hora, fecha, tarjeta, "con", "desde" o fin de frase.
const END = String.raw`(?=\s+(?:el|a las|con|desde|con tu|en tu|por|\d{1,2}:\d{2}|\d{1,2}/\d{1,2})\b|[,;!]|\.(?:\s|$)|$)`;
const MERCHANT = `(?<merchant>.+?)${END}`;
const LAST4 = String.raw`(?:\*|terminada en |finalizada en )(?<last4>\d{4})`;
const DATE = String.raw`(?<date>\d{1,2}/\d{1,2}/\d{2,4})`;
const TIME = String.raw`(?<time>\d{1,2}:\d{2})`;

/**
 * Formas de los avisos de cada banco. Los ejemplos de `fixtures.ts` las cubren todas; si un banco
 * cambia el texto, la prueba de ese banco falla y aquí se agrega la forma nueva.
 */
export const BANKS: readonly BankParser[] = [
  {
    bank: "Nequi",
    apps: ["com.nequi.MobileApp"],
    rules: [
      { pattern: re(`(?:entre|a) tus? (?:bolsillos?|colch[oó]n|metas?)`), kind: null },
      {
        pattern: re(`pagaste(?: con QR)? ${AMOUNT} (?:en|a) ${MERCHANT}`),
        kind: "expense",
      },
      {
        pattern: re(`(?:enviaste|le enviaste) ${AMOUNT} a ${MERCHANT}`),
        kind: "expense",
      },
      { pattern: re(`retiraste ${AMOUNT}`), kind: "expense" },
      { pattern: re(`(?<merchant>[^.!]+?) te envi[oó] ${AMOUNT}`), kind: "income" },
      {
        pattern: re(`(?:te envi[oó]|recibiste) ${AMOUNT}(?: de ${MERCHANT})?`),
        kind: "income",
      },
    ],
  },
  {
    bank: "Daviplata",
    apps: ["com.davivienda.daviplataapp"],
    rules: [
      {
        pattern: re(`(?:pagaste|compra(?: aprobada)? por) ${AMOUNT} en ${MERCHANT}`),
        kind: "expense",
      },
      {
        pattern: re(`(?:transferiste|pasaste|enviaste) ${AMOUNT} a ${MERCHANT}`),
        kind: "expense",
      },
      { pattern: re(`(?:sacaste|retiraste) ${AMOUNT}`), kind: "expense" },
      {
        pattern: re(`(?:recibiste|te (?:pasaron|enviaron|abonaron)) ${AMOUNT}(?: de ${MERCHANT})?`),
        kind: "income",
      },
    ],
  },
  {
    bank: "Bancolombia",
    apps: ["com.todo1.mobile"],
    rules: [
      { pattern: re(`pago (?:de|a) (?:tu )?tarjeta`), kind: null },
      {
        pattern: re(
          String.raw`compra(?:ste)? por ${AMOUNT} en ${MERCHANT}(?: ${TIME})?(?:\.? ${DATE})?.*?${LAST4}`,
        ),
        kind: "expense",
      },
      { pattern: re(`compra(?:ste)? por ${AMOUNT} en ${MERCHANT}`), kind: "expense" },
      {
        pattern: re(`(?:pago|pagaste) por ${AMOUNT} a ${MERCHANT}(?:.*?${LAST4})?`),
        kind: "expense",
      },
      {
        pattern: re(
          `(?:transferiste|transferencia) por ${AMOUNT} (?:a|hacia) (?:la cuenta )?${MERCHANT}(?:.*?${LAST4})?`,
        ),
        kind: "expense",
      },
      { pattern: re(`retir(?:o|aste) por ${AMOUNT}(?:.*?${LAST4})?`), kind: "expense" },
      {
        pattern: re(
          `(?:recibiste|recepci[oó]n de) (?:una )?(?:transferencia )?por ${AMOUNT}(?: de ${MERCHANT})?(?:.*?${LAST4})?`,
        ),
        kind: "income",
      },
    ],
  },
  {
    bank: "Davivienda",
    apps: ["com.davivienda.daviviendaapp"],
    rules: [
      { pattern: re(`pago (?:de|a) (?:tu )?tarjeta`), kind: null },
      {
        pattern: re(
          `compra(?: aprobada)? por ${AMOUNT} en ${MERCHANT}(?:.*?${LAST4})?(?:.*?${DATE})?(?:.*?${TIME})?`,
        ),
        kind: "expense",
      },
      {
        pattern: re(`(?:pago|transferencia) por ${AMOUNT} a ${MERCHANT}(?:.*?${LAST4})?`),
        kind: "expense",
      },
      { pattern: re(`retiro por ${AMOUNT}(?:.*?${LAST4})?`), kind: "expense" },
      {
        pattern: re(`abono (?:a|en) tu cuenta ${LAST4} por ${AMOUNT}(?: de ${MERCHANT})?`),
        kind: "income",
      },
    ],
  },
  {
    bank: "BBVA",
    apps: ["co.com.bbva.mb"],
    rules: [
      { pattern: re(`pago (?:de|a) (?:tu )?tarjeta`), kind: null },
      {
        pattern: re(`compra por ${AMOUNT} en ${MERCHANT}(?:.*?${LAST4})?`),
        kind: "expense",
      },
      {
        pattern: re(`transferencia (?:enviada )?por ${AMOUNT} a ${MERCHANT}`),
        kind: "expense",
      },
      {
        pattern: re(`(?:abono|transferencia recibida) por ${AMOUNT}(?: de ${MERCHANT})?`),
        kind: "income",
      },
    ],
  },
  {
    bank: "Nu",
    apps: ["com.nu.production"],
    rules: [
      { pattern: re(`pag(?:o|aste) (?:de )?tu (?:tarjeta|factura)`), kind: null },
      {
        pattern: re(`(?:compra aprobada|compraste)[:.]? ${AMOUNT} en ${MERCHANT}`),
        kind: "expense",
      },
      {
        pattern: re(`(?:enviaste|transferiste) ${AMOUNT} a ${MERCHANT}`),
        kind: "expense",
      },
      {
        pattern: re(`(?:recibiste|te enviaron) ${AMOUNT}(?: de ${MERCHANT})?`),
        kind: "income",
      },
    ],
  },
];

export const bankFor = (app: string): BankParser | undefined =>
  BANKS.find((b) => b.apps.includes(app));
