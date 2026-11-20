// Genera con Chromium (fuentes Type0/Identity-H, flujos de objetos) los extractos de prueba de
// Davivienda, BBVA y Nu. Datos inventados. Uso, desde apps/mobile:
//   node src/import/statements/fixtures/generate.mjs && python3 src/import/statements/fixtures/generate.py
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const here = dirname(fileURLToPath(import.meta.url));

const us = (minor) => {
  const v = Math.abs(minor);
  const whole = Math.floor(v / 100).toLocaleString("en-US");
  return `${whole}.${String(v % 100).padStart(2, "0")}`;
};
const co = (minor) => us(minor).replace(/,/g, "_").replace(".", ",").replace(/_/g, ".");
const coWhole = (minor) =>
  Math.floor(Math.abs(minor) / 100)
    .toLocaleString("en-US")
    .replace(/,/g, ".");

const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body { font-family: "DejaVu Sans", sans-serif; font-size: 9pt; margin: 32px; color: #222; }
  h1 { font-size: 15pt; margin: 0 0 4px; } p { margin: 2px 0; }
  table { border-collapse: collapse; width: 100%; margin-top: 14px; }
  th { text-align: left; border-bottom: 1px solid #999; padding: 4px; font-size: 8pt; }
  td { padding: 3px 4px; } .n { text-align: right; white-space: nowrap; }
  footer { margin-top: 18px; font-size: 7pt; color: #777; }
</style></head><body>${body}<footer>Extracto de prueba: todos los datos son inventados.</footer></body></html>`;

function davivienda() {
  const rows = [
    ["03 10", -9800000, "", "Compra Carulla Calle 85", "Bogotá"],
    ["06 10", 280000000, "", "Abono Nómina", ""],
    ["08 10", -4500000, "1123", "Pago Factura Movistar", ""],
    ["14 10", -20000000, "", "Retiro Cajero Davivienda", "Usaquén"],
    ["19 10", -6720000, "", "Compra Farmatodo", ""],
    ["27 10", -35000000, "", "Transferencia a 0570123498765432", ""],
  ];
  let balance = 90000000;
  const trs = rows
    .map(([date, amount, doc, desc, office]) => {
      balance += amount;
      return `<tr><td>${date}</td><td class="n">$ ${us(amount)}${amount < 0 ? "-" : "+"}</td><td>${doc}</td><td>${desc}</td><td>${office}</td></tr>`;
    })
    .join("");
  return page(`<h1>DAVIVIENDA</h1><p>Extracto Cuenta de Ahorros</p><p>Cliente: PERSONA DE PRUEBA · Cuenta ****4321</p>
  <p>Periodo: 2026/10/01 - 2026/10/31</p>
  <p>Saldo Anterior: $ ${us(90000000)}</p>
  <table><tr><th>Fecha</th><th class="n">Valor</th><th>Doc.</th><th>Clase de Movimiento</th><th>Oficina</th></tr>${trs}</table>
  <p>Saldo Final: $ ${us(balance)}</p>`);
}

function bbva() {
  const rows = [
    ["02-10-2026", "02-10-2026", "PAGO PSE ETB", -8990000, 0],
    ["07-10-2026", "07-10-2026", "ABONO TRANSFERENCIA RECIBIDA", 0, 45000000],
    ["11-10-2026", "11-10-2026", "COMPRA OLIMPICA", -15430000, 0],
    ["16-10-2026", "17-10-2026", "COMPRA JUAN VALDEZ CAFE", -1250000, 0],
    ["29-10-2026", "29-10-2026", "COMISION TRANSFERENCIA", -680000, 0],
  ];
  let balance = 50000000;
  const trs = rows
    .map(([op, val, desc, charge, credit]) => {
      balance += charge + credit;
      return `<tr><td>${op}</td><td>${val}</td><td>${desc}</td><td class="n">${charge ? co(charge) : ""}</td><td class="n">${credit ? co(credit) : ""}</td><td class="n">${co(balance)}</td></tr>`;
    })
    .join("");
  return page(`<h1>BBVA Colombia</h1><p>Extracto de Cuenta de Ahorro · PERSONA DE PRUEBA</p>
  <p>Cuenta: 0013 **** **** 7788</p><p>Del 01/10/2026 al 31/10/2026</p>
  <table><tr><th>F. Oper.</th><th>F. Valor</th><th>Concepto</th><th class="n">Cargos</th><th class="n">Abonos</th><th class="n">Saldo</th></tr>
  <tr><td></td><td></td><td>SALDO INICIAL</td><td></td><td></td><td class="n">${co(50000000)}</td></tr>${trs}</table>`);
}

function nu() {
  const rows = [
    ["28 sep", "Rappi Colombia", "1/1", 6250000],
    ["30 sep", "Spotify", "1/1", 1690000],
    ["03 oct", "Falabella Andino", "1/3", 45000000],
    ["10 oct", "Pago recibido. ¡Gracias!", "", -60000000],
    ["14 oct", "Uber", "1/1", 1870000],
    ["21 oct", "Éxito Unicentro", "1/1", 23415000],
  ];
  const trs = rows
    .map(
      ([date, desc, fee, amount]) =>
        `<tr><td>${date}</td><td>${desc}</td><td>${fee}</td><td class="n">${amount < 0 ? "-" : ""}$ ${coWhole(amount)}</td></tr>`,
    )
    .join("");
  return page(`<h1>Nu</h1><p>Extracto de tu Tarjeta de Crédito Nu</p><p>PERSONA DE PRUEBA · Tarjeta terminada en 1234</p>
  <p>Periodo facturado: 26 sep 2026 - 25 oct 2026</p><p>Fecha límite de pago: 10 nov 2026</p>
  <p>Pago mínimo: $ 120.000 · Pago total: $ 1.188.000</p>
  <table><tr><th>Fecha</th><th>Descripción</th><th>Cuota</th><th class="n">Valor</th></tr>${trs}</table>`);
}

const browser = await chromium.launch();
const tab = await browser.newPage();
for (const [name, html] of [
  ["davivienda", davivienda()],
  ["bbva", bbva()],
  ["nu", nu()],
]) {
  await tab.setContent(html);
  await tab.pdf({ path: join(here, `${name}.pdf`), format: "Letter" });
}
await browser.close();
