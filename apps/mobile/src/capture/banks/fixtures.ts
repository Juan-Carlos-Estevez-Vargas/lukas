/**
 * Avisos de ejemplo por banco. Son inventados imitando la forma de cada app; los montos, comercios
 * y tarjetas no son de nadie. Cuando haya textos reales (anonimizados) se agregan aquí.
 * `expect: null` es un aviso que no debe llegar a la bandeja.
 */
export interface NotificationFixture {
  readonly title: string;
  readonly text: string;
  readonly expect: {
    readonly kind: "expense" | "income";
    readonly amount: string;
    readonly merchant: string | null;
    readonly last4?: string;
    /** "dd/mm hh:mm" si el aviso trae su propia fecha u hora. */
    readonly at?: string;
  } | null;
}

export const FIXTURES: Record<string, readonly NotificationFixture[]> = {
  "com.nequi.MobileApp": [
    {
      title: "Nequi",
      text: "Pagaste $23.450 en TIENDAS ARA.",
      expect: { kind: "expense", amount: "23450.00", merchant: "Tiendas Ara" },
    },
    {
      title: "Nequi",
      text: "¡Pagaste con QR $8.000 en PANADERIA LA 80!",
      expect: { kind: "expense", amount: "8000.00", merchant: "Panaderia La 80" },
    },
    {
      title: "Nequi",
      text: "Le enviaste $20.000 a MARIA GOMEZ",
      expect: { kind: "expense", amount: "20000.00", merchant: "Maria Gomez" },
    },
    {
      title: "Nequi",
      text: "Retiraste $100.000 en un cajero Bancolombia",
      expect: { kind: "expense", amount: "100000.00", merchant: null },
    },
    {
      title: "Nequi",
      text: "JUAN PEREZ te envió $50.000",
      expect: { kind: "income", amount: "50000.00", merchant: "Juan Perez" },
    },
    {
      title: "Recibiste plata",
      text: "Recibiste $1.200.000 de EMPRESA SAS",
      expect: { kind: "income", amount: "1200000.00", merchant: "Empresa Sas" },
    },
    { title: "Nequi", text: "Moviste $30.000 a tu bolsillo Viaje", expect: null },
    { title: "Nequi", text: "Tu código para entrar es 123456", expect: null },
  ],
  "com.davivienda.daviplataapp": [
    {
      title: "DaviPlata",
      text: "Compra aprobada por $12.000 en D1 SUBA",
      expect: { kind: "expense", amount: "12000.00", merchant: "D1 Suba" },
    },
    {
      title: "DaviPlata",
      text: "Pasaste $30.000 a 3001234567",
      expect: { kind: "expense", amount: "30000.00", merchant: null },
    },
    {
      title: "DaviPlata",
      text: "Te pasaron $15.000 de CARLOS RUIZ",
      expect: { kind: "income", amount: "15000.00", merchant: "Carlos Ruiz" },
    },
    {
      title: "DaviPlata",
      text: "Sacaste $50.000 en cajero",
      expect: { kind: "expense", amount: "50000.00", merchant: null },
    },
  ],
  "com.todo1.mobile": [
    {
      title: "Bancolombia",
      text: "Bancolombia le informa Compra por $45.900,00 en RAPPI*RESTAURANTE 13:01. 05/11/2026 T.Deb *1234. Inquietudes al 018000931987",
      expect: {
        kind: "expense",
        amount: "45900.00",
        merchant: "Rappi*Restaurante",
        last4: "1234",
        at: "05/11 13:01",
      },
    },
    {
      title: "Bancolombia",
      text: "Compraste por $89.000 en EXITO CALLE 80 con tu T.Cred *9876",
      expect: { kind: "expense", amount: "89000.00", merchant: "Exito Calle 80", last4: "9876" },
    },
    {
      title: "Bancolombia",
      text: "Bancolombia le informa Pago por $120.000 a CLARO desde cta *5678",
      expect: { kind: "expense", amount: "120000.00", merchant: "Claro", last4: "5678" },
    },
    {
      title: "Bancolombia",
      text: "Bancolombia: Recibiste una transferencia por $1.500.000 de EMPRESA SAS en tu cuenta *5678",
      expect: { kind: "income", amount: "1500000.00", merchant: "Empresa Sas", last4: "5678" },
    },
    {
      title: "Bancolombia",
      text: "Bancolombia le informa Retiro por $200.000 en CAJERO CENTRO T.Deb *1234",
      expect: { kind: "expense", amount: "200000.00", merchant: null, last4: "1234" },
    },
    {
      title: "Bancolombia",
      text: "Bancolombia le informa Pago de tarjeta por $500.000 desde cta *5678",
      expect: null,
    },
  ],
  "com.davivienda.daviviendaapp": [
    {
      title: "Davivienda",
      text: "Davivienda: Compra aprobada por $35.000 en CARULLA con tarjeta terminada en 4321 el 05/11/2026 a las 13:01",
      expect: {
        kind: "expense",
        amount: "35000.00",
        merchant: "Carulla",
        last4: "4321",
        at: "05/11 13:01",
      },
    },
    {
      title: "Davivienda",
      text: "Davivienda: Abono a tu cuenta *8765 por $500.000 de NOMINA EMPRESA",
      expect: { kind: "income", amount: "500000.00", merchant: "Nomina Empresa", last4: "8765" },
    },
    {
      title: "Davivienda",
      text: "Davivienda: Pago de tarjeta por $300.000 recibido",
      expect: null,
    },
  ],
  "co.com.bbva.mb": [
    {
      title: "BBVA",
      text: "BBVA: Compra por $25.000 en FARMATODO con tarjeta *1111",
      expect: { kind: "expense", amount: "25000.00", merchant: "Farmatodo", last4: "1111" },
    },
    {
      title: "BBVA",
      text: "Transferencia recibida por $80.000 de ANA TORRES",
      expect: { kind: "income", amount: "80000.00", merchant: "Ana Torres" },
    },
  ],
  "com.nu.production": [
    {
      title: "Compra aprobada",
      text: "Compra aprobada: $60.000 en NETFLIX.COM",
      expect: { kind: "expense", amount: "60000.00", merchant: "Netflix.com" },
    },
    {
      title: "Nu",
      text: "Recibiste $100.000 de PEDRO DIAZ",
      expect: { kind: "income", amount: "100000.00", merchant: "Pedro Diaz" },
    },
    { title: "Nu", text: "Pagaste tu factura por $300.000", expect: null },
  ],
};
