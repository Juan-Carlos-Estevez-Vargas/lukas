import type { Money } from "@lukas/domain";
import { useState } from "react";
import { Text, View } from "react-native";
import { Button } from "../components/ui";
import type { SqlConnection } from "../data/sql";
import { formatMonth } from "../format/date";
import { formatMoney } from "../format/money";
import { useI18n } from "../i18n/i18n";
import { copRates } from "../rates/rates";
import type { Month } from "../reports/reports";
import { useTheme } from "../theme/theme";
import { deliverFile } from "./files";
import { monthlyReport } from "./monthly";
import { type ReportLabels, reportFileName, reportPdf, reportXlsx } from "./report";

const MIME = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

/** Descargar el reporte del mes elegido en PDF o Excel. Los montos salen siempre visibles. */
export function ExportButtons({
  db,
  month,
}: {
  readonly db: SqlConnection;
  readonly month: Month;
}) {
  const { t, locale } = useI18n();
  const { colors, space, fontSize } = useTheme();
  const [busy, setBusy] = useState<"pdf" | "xlsx" | null>(null);
  const [failed, setFailed] = useState(false);

  const labels = (): ReportLabels => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
      title: t("export.title", { month: formatMonth(month, locale, "long") }),
      generated: t("export.generated", {
        date: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date()),
      }),
      income: t("reports.income"),
      expenses: t("reports.expenses"),
      net: t("export.net"),
      expensesByCategory: t("export.expensesByCategory"),
      incomeByCategory: t("export.incomeByCategory"),
      accounts: t("export.accounts"),
      account: t("csv.account"),
      currency: t("csv.currency"),
      opening: t("export.opening"),
      closing: t("export.closing"),
      summary: t("export.summary"),
      empty: t("export.empty"),
      headers: {
        date: t("csv.date"),
        kind: t("csv.kind"),
        category: t("csv.category"),
        description: t("csv.merchant"),
        notes: t("csv.note"),
        amount: t("csv.amount"),
      },
      kinds: {
        expense: t("list.kind.expense"),
        income: t("list.kind.income"),
        transfer: t("list.kind.transfer"),
        adjustment: t("list.kind.adjustment"),
      },
      page: (n, total) => t("export.page", { n, total }),
      money: (m: Money) => formatMoney(m, { locale, discreet: false }),
      date: (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`,
    };
  };

  const download = async (format: "pdf" | "xlsx") => {
    if (busy) return;
    setBusy(format);
    setFailed(false);
    try {
      const { table } = await copRates(db);
      const report = await monthlyReport(db, month, "COP", table);
      const data = format === "pdf" ? reportPdf(report, labels()) : reportXlsx(report, labels());
      await deliverFile(reportFileName(report, format), data, MIME[format]);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ gap: space.xs }}>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            label={t("export.pdf")}
            variant="plain"
            busy={busy === "pdf"}
            onPress={() => void download("pdf")}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label={t("export.xlsx")}
            variant="plain"
            busy={busy === "xlsx"}
            onPress={() => void download("xlsx")}
          />
        </View>
      </View>
      {failed ? (
        <Text style={{ color: colors.expense, fontSize: fontSize.caption }}>
          {t("export.failed")}
        </Text>
      ) : null}
    </View>
  );
}
