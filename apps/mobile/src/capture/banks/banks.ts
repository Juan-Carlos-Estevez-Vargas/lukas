import type { BankParser } from "./rules";

/*
 * Formas de los avisos de cada banco. Son literales (sin `new RegExp`) para que el análisis
 * estático las revise y nadie pueda inyectar una expresión. Piezas que se repiten:
 *
 * - Monto: `(?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)` ("$45.900", "COP 8.000").
 * - Comercio: `(?<merchant>.+?)` hasta hora, fecha, "el", "con", "desde", "por" o fin de frase.
 * - Tarjeta: `(?:\*|terminada en |finalizada en )(?<last4>\d{4})`, a menos de 80 caracteres.
 * - Fecha y hora: `(?<date>\d{1,2}/\d{1,2}/\d{2,4})` y `(?<time>\d{1,2}:\d{2})`.
 *
 * Los ejemplos de `fixtures.ts` las cubren todas; si un banco cambia el texto, la prueba de ese
 * banco falla y aquí se agrega la forma nueva.
 */
export const BANKS: readonly BankParser[] = [
  {
    bank: "Nequi",
    apps: ["com.nequi.MobileApp"],
    rules: [
      { pattern: /(?:entre|a) tus? (?:bolsillos?|colch[oó]n|metas?)/i, kind: null },
      {
        pattern:
          /pagaste(?: con QR)? (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?) (?:en|a) (?<merchant>.+?)(?=\s+(?:el|a las|con|desde|con tu|en tu|por|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})\b|[,;!]|\.(?:\s|$)|$)/i,
        kind: "expense",
      },
      {
        pattern:
          /(?:enviaste|le enviaste) (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?) a (?<merchant>.+?)(?=\s+(?:el|a las|con|desde|con tu|en tu|por|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})\b|[,;!]|\.(?:\s|$)|$)/i,
        kind: "expense",
      },
      {
        pattern: /retiraste (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)/i,
        kind: "expense",
      },
      {
        pattern:
          /(?<merchant>[^.!]+?) te envi[oó] (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)/i,
        kind: "income",
      },
      {
        pattern:
          /(?:te envi[oó]|recibiste) (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)(?: de (?<merchant>.+?)(?=\s+(?:el|a las|con|desde|con tu|en tu|por|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})\b|[,;!]|\.(?:\s|$)|$))?/i,
        kind: "income",
      },
    ],
  },
  {
    bank: "Daviplata",
    apps: ["com.davivienda.daviplataapp"],
    rules: [
      {
        pattern:
          /(?:pagaste|compra(?: aprobada)? por) (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?) en (?<merchant>.+?)(?=\s+(?:el|a las|con|desde|con tu|en tu|por|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})\b|[,;!]|\.(?:\s|$)|$)/i,
        kind: "expense",
      },
      {
        pattern:
          /(?:transferiste|pasaste|enviaste) (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?) a (?<merchant>.+?)(?=\s+(?:el|a las|con|desde|con tu|en tu|por|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})\b|[,;!]|\.(?:\s|$)|$)/i,
        kind: "expense",
      },
      {
        pattern:
          /(?:sacaste|retiraste) (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)/i,
        kind: "expense",
      },
      {
        pattern:
          /(?:recibiste|te (?:pasaron|enviaron|abonaron)) (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)(?: de (?<merchant>.+?)(?=\s+(?:el|a las|con|desde|con tu|en tu|por|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})\b|[,;!]|\.(?:\s|$)|$))?/i,
        kind: "income",
      },
    ],
  },
  {
    bank: "Bancolombia",
    apps: ["com.todo1.mobile"],
    rules: [
      { pattern: /pago (?:de|a) (?:tu )?tarjeta/i, kind: null },
      {
        pattern:
          /compra(?:ste)? por (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?) en (?<merchant>.+?)(?=\s+(?:el|a las|con|desde|con tu|en tu|por|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})\b|[,;!]|\.(?:\s|$)|$)(?: (?<time>\d{1,2}:\d{2}))?(?:\.? (?<date>\d{1,2}\/\d{1,2}\/\d{2,4}))?.{0,80}?(?:\*|terminada en |finalizada en )(?<last4>\d{4})/i,
        kind: "expense",
      },
      {
        pattern:
          /compra(?:ste)? por (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?) en (?<merchant>.+?)(?=\s+(?:el|a las|con|desde|con tu|en tu|por|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})\b|[,;!]|\.(?:\s|$)|$)/i,
        kind: "expense",
      },
      {
        pattern:
          /(?:pago|pagaste) por (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?) a (?<merchant>.+?)(?=\s+(?:el|a las|con|desde|con tu|en tu|por|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})\b|[,;!]|\.(?:\s|$)|$)(?:.{0,80}?(?:\*|terminada en |finalizada en )(?<last4>\d{4}))?/i,
        kind: "expense",
      },
      {
        pattern:
          /(?:transferiste|transferencia) por (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?) (?:a|hacia) (?:la cuenta )?(?<merchant>.+?)(?=\s+(?:el|a las|con|desde|con tu|en tu|por|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})\b|[,;!]|\.(?:\s|$)|$)(?:.{0,80}?(?:\*|terminada en |finalizada en )(?<last4>\d{4}))?/i,
        kind: "expense",
      },
      {
        pattern:
          /retir(?:o|aste) por (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)(?:.{0,80}?(?:\*|terminada en |finalizada en )(?<last4>\d{4}))?/i,
        kind: "expense",
      },
      {
        pattern:
          /(?:recibiste|recepci[oó]n de) (?:una )?(?:transferencia )?por (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)(?: de (?<merchant>.+?)(?=\s+(?:el|a las|con|desde|con tu|en tu|por|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})\b|[,;!]|\.(?:\s|$)|$))?(?:.{0,80}?(?:\*|terminada en |finalizada en )(?<last4>\d{4}))?/i,
        kind: "income",
      },
    ],
  },
  {
    bank: "Davivienda",
    apps: ["com.davivienda.daviviendaapp"],
    rules: [
      { pattern: /pago (?:de|a) (?:tu )?tarjeta/i, kind: null },
      {
        pattern:
          /compra(?: aprobada)? por (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?) en (?<merchant>.+?)(?=\s+(?:el|a las|con|desde|con tu|en tu|por|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})\b|[,;!]|\.(?:\s|$)|$)(?:.{0,80}?(?:\*|terminada en |finalizada en )(?<last4>\d{4}))?(?:.{0,80}?(?<date>\d{1,2}\/\d{1,2}\/\d{2,4}))?(?:.{0,80}?(?<time>\d{1,2}:\d{2}))?/i,
        kind: "expense",
      },
      {
        pattern:
          /(?:pago|transferencia) por (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?) a (?<merchant>.+?)(?=\s+(?:el|a las|con|desde|con tu|en tu|por|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})\b|[,;!]|\.(?:\s|$)|$)(?:.{0,80}?(?:\*|terminada en |finalizada en )(?<last4>\d{4}))?/i,
        kind: "expense",
      },
      {
        pattern:
          /retiro por (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)(?:.{0,80}?(?:\*|terminada en |finalizada en )(?<last4>\d{4}))?/i,
        kind: "expense",
      },
      {
        pattern:
          /abono (?:a|en) tu cuenta (?:\*|terminada en |finalizada en )(?<last4>\d{4}) por (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)(?: de (?<merchant>.+?)(?=\s+(?:el|a las|con|desde|con tu|en tu|por|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})\b|[,;!]|\.(?:\s|$)|$))?/i,
        kind: "income",
      },
    ],
  },
  {
    bank: "BBVA",
    apps: ["co.com.bbva.mb"],
    rules: [
      { pattern: /pago (?:de|a) (?:tu )?tarjeta/i, kind: null },
      {
        pattern:
          /compra por (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?) en (?<merchant>.+?)(?=\s+(?:el|a las|con|desde|con tu|en tu|por|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})\b|[,;!]|\.(?:\s|$)|$)(?:.{0,80}?(?:\*|terminada en |finalizada en )(?<last4>\d{4}))?/i,
        kind: "expense",
      },
      {
        pattern:
          /transferencia (?:enviada )?por (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?) a (?<merchant>.+?)(?=\s+(?:el|a las|con|desde|con tu|en tu|por|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})\b|[,;!]|\.(?:\s|$)|$)/i,
        kind: "expense",
      },
      {
        pattern:
          /(?:abono|transferencia recibida) por (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)(?: de (?<merchant>.+?)(?=\s+(?:el|a las|con|desde|con tu|en tu|por|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})\b|[,;!]|\.(?:\s|$)|$))?/i,
        kind: "income",
      },
    ],
  },
  {
    bank: "Nu",
    apps: ["com.nu.production"],
    rules: [
      { pattern: /pag(?:o|aste) (?:de )?tu (?:tarjeta|factura)/i, kind: null },
      {
        pattern:
          /(?:compra aprobada|compraste)[:.]? (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?) en (?<merchant>.+?)(?=\s+(?:el|a las|con|desde|con tu|en tu|por|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})\b|[,;!]|\.(?:\s|$)|$)/i,
        kind: "expense",
      },
      {
        pattern:
          /(?:enviaste|transferiste) (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?) a (?<merchant>.+?)(?=\s+(?:el|a las|con|desde|con tu|en tu|por|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})\b|[,;!]|\.(?:\s|$)|$)/i,
        kind: "expense",
      },
      {
        pattern:
          /(?:recibiste|te enviaron) (?:\$|COP)\s?(?<amount>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)(?: de (?<merchant>.+?)(?=\s+(?:el|a las|con|desde|con tu|en tu|por|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})\b|[,;!]|\.(?:\s|$)|$))?/i,
        kind: "income",
      },
    ],
  },
];

export const bankFor = (app: string): BankParser | undefined =>
  BANKS.find((b) => b.apps.includes(app));
