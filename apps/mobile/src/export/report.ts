import type { Money } from "@lukas/domain";
import type { ListKind } from "../movements/filters";
import type { MonthlyReport } from "./monthly";
import { clip, PAGE, PdfWriter } from "./pdf-writer";
import { buildXlsx, type Cell, money, type Sheet, text } from "./xlsx";

/** Textos ya traducidos y formatos de la persona: el armado no sabe de idiomas. */
export interface ReportLabels {
  readonly title: string;
  readonly generated: string;
  readonly income: string;
  readonly expenses: string;
  readonly net: string;
  readonly expensesByCategory: string;
  readonly incomeByCategory: string;
  readonly accounts: string;
  readonly account: string;
  readonly currency: string;
  readonly opening: string;
  readonly closing: string;
  readonly summary: string;
  readonly empty: string;
  readonly headers: {
    readonly date: string;
    readonly kind: string;
    readonly category: string;
    readonly description: string;
    readonly notes: string;
    readonly amount: string;
  };
  readonly kinds: Record<ListKind, string>;
  readonly page: (n: number, total: number) => string;
  readonly money: (m: Money) => string;
  readonly date: (d: Date) => string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const net = (r: MonthlyReport): Money => r.income.subtract(r.expenses);

const MARGIN = 40;
const TOP = PAGE.height - 40;
const BOTTOM = 56;
const RIGHT = PAGE.width - MARGIN;
const COLS = { date: MARGIN, kind: 92, category: 160, description: 290, amount: RIGHT } as const;

/** PDF del mes: resumen, categorías y los movimientos de cada cuenta. */
export function reportPdf(report: MonthlyReport, labels: ReportLabels): Uint8Array {
  const pdf = new PdfWriter(labels.title);
  let y = TOP;
  let repeatHeader: (() => void) | null = null;

  const need = (height: number) => {
    if (y - height >= BOTTOM) return;
    pdf.newPage();
    y = TOP;
    repeatHeader?.();
  };
  const row = (label: string, value: string, bold = false, indent = 0) => {
    need(14);
    pdf.text(MARGIN + indent, y, clip(label, 10, 380), { size: 10, bold });
    pdf.text(RIGHT, y, value, { size: 10, bold, align: "right" });
    y -= 14;
  };
  const heading = (title: string, size = 12) => {
    need(size + 30);
    y -= 8;
    pdf.text(MARGIN, y, title, { size, bold: true });
    y -= 6;
    pdf.line(MARGIN, y, RIGHT, y);
    y -= 14;
  };

  pdf.text(MARGIN, y, labels.title, { size: 18, bold: true });
  y -= 16;
  pdf.text(MARGIN, y, labels.generated, { size: 8, gray: 0.4 });
  y -= 10;

  heading(labels.summary);
  row(labels.income, labels.money(report.income));
  row(labels.expenses, labels.money(report.expenses));
  row(labels.net, labels.money(net(report)), true);

  for (const [title, list] of [
    [labels.expensesByCategory, report.expenseCategories],
    [labels.incomeByCategory, report.incomeCategories],
  ] as const) {
    if (list.length === 0) continue;
    heading(title);
    for (const c of list) row(c.name, labels.money(c.amount), false, 0);
  }

  heading(labels.accounts);
  const tableHeader = () => {
    const h = labels.headers;
    for (const [x, label, align] of [
      [COLS.date, h.date, "left"],
      [COLS.kind, h.kind, "left"],
      [COLS.category, h.category, "left"],
      [COLS.description, h.description, "left"],
      [COLS.amount, h.amount, "right"],
    ] as const) {
      pdf.text(x, y, label, { size: 8, bold: true, gray: 0.35, align });
    }
    y -= 12;
  };
  for (const account of report.accounts) {
    repeatHeader = null;
    need(60);
    y -= 6;
    pdf.text(MARGIN, y, account.name, { size: 11, bold: true });
    pdf.text(
      RIGHT,
      y,
      `${labels.opening}: ${labels.money(account.opening)}  ·  ${labels.closing}: ${labels.money(account.closing)}`,
      { size: 8, align: "right", gray: 0.3 },
    );
    y -= 14;
    if (account.movements.length === 0) {
      pdf.text(MARGIN, y, labels.empty, { size: 8.5, gray: 0.45 });
      y -= 14;
      continue;
    }
    tableHeader();
    repeatHeader = tableHeader;
    for (const m of account.movements) {
      need(12);
      pdf.text(COLS.date, y, labels.date(m.occurredAt), { size: 8.5 });
      pdf.text(COLS.kind, y, clip(labels.kinds[m.kind], 8.5, 64), { size: 8.5 });
      pdf.text(COLS.category, y, clip(m.category, 8.5, 124), { size: 8.5 });
      pdf.text(COLS.description, y, clip(m.merchant || m.notes, 8.5, 190), { size: 8.5 });
      pdf.text(COLS.amount, y, labels.money(m.amount), { size: 8.5, align: "right" });
      y -= 12;
    }
    repeatHeader = null;
    y -= 4;
  }

  const total = pdf.pageCount;
  for (let i = 0; i < total; i++) {
    pdf.goTo(i);
    pdf.text(MARGIN, 30, `Lukas · ${labels.title}`, { size: 7, gray: 0.5 });
    pdf.text(RIGHT, 30, labels.page(i + 1, total), { size: 7, gray: 0.5, align: "right" });
  }
  return pdf.finish();
}

const amount = (m: Money): Cell => money(m.toDecimalString());

/** Excel del mes: una hoja de resumen y una hoja por cuenta. */
export function reportXlsx(report: MonthlyReport, labels: ReportLabels): Uint8Array {
  const summary: Cell[][] = [
    [text(labels.title, true)],
    [text(labels.generated)],
    [],
    [text(labels.income), amount(report.income), text(report.currency)],
    [text(labels.expenses), amount(report.expenses), text(report.currency)],
    [text(labels.net, true), amount(net(report)), text(report.currency)],
  ];
  for (const [title, list] of [
    [labels.expensesByCategory, report.expenseCategories],
    [labels.incomeByCategory, report.incomeCategories],
  ] as const) {
    if (list.length === 0) continue;
    summary.push([], [text(title, true)]);
    for (const c of list) summary.push([text(c.name), amount(c.amount), text(report.currency)]);
  }
  summary.push(
    [],
    [
      text(labels.account, true),
      text(labels.opening, true),
      text(labels.closing, true),
      text(labels.currency, true),
    ],
  );
  for (const a of report.accounts) {
    summary.push([text(a.name), amount(a.opening), amount(a.closing), text(a.currency)]);
  }

  const h = labels.headers;
  const sheets: Sheet[] = [
    { name: labels.summary, rows: summary, widths: [34, 18, 18, 10] },
    ...report.accounts.map((a) => ({
      name: a.name,
      widths: [12, 14, 22, 32, 28, 16],
      rows: [
        [text(labels.opening, true), null, null, null, null, amount(a.opening)],
        [
          text(h.date, true),
          text(h.kind, true),
          text(h.category, true),
          text(h.description, true),
          text(h.notes, true),
          text(`${h.amount} (${a.currency})`, true),
        ],
        ...a.movements.map((m) => [
          text(isoDay(m.occurredAt)),
          text(labels.kinds[m.kind]),
          text(m.category),
          text(m.merchant),
          text(m.notes),
          amount(m.amount),
        ]),
        [text(labels.closing, true), null, null, null, null, amount(a.closing)],
      ],
    })),
  ];
  return buildXlsx(sheets);
}

export const reportFileName = (report: MonthlyReport, extension: "pdf" | "xlsx") =>
  `lukas-${report.month.year}-${pad(report.month.month)}.${extension}`;
