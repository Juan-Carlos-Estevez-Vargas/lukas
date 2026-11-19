import { ratio } from "@lukas/charts";
import { Money } from "@lukas/domain";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { BarChart } from "../../src/charts/bar-chart";
import { LineChart } from "../../src/charts/line-chart";
import { Chip, ChipRow } from "../../src/components/quick";
import { Body, Screen, Title } from "../../src/components/ui";
import { useLocalDatabase } from "../../src/data/provider";
import { useDiscreet } from "../../src/display/discreet";
import { formatMonth } from "../../src/format/date";
import { formatMoney } from "../../src/format/money";
import type { CategorySpend } from "../../src/home/home";
import { Card } from "../../src/home/home-cards";
import { useI18n } from "../../src/i18n/i18n";
import { copRates } from "../../src/rates/rates";
import {
  cashFlow,
  lastMonths,
  type Month,
  type MonthFlow,
  type MonthNetWorth,
  monthKey,
  netWorthSeries,
  spendingByCategory,
} from "../../src/reports/reports";
import { useSync } from "../../src/sync/use-sync";
import { useTheme } from "../../src/theme/theme";

const MONTHS = 6;
const CHART_HEIGHT = 160;

export default function Reports() {
  const { t, locale } = useI18n();
  const { discreet } = useDiscreet();
  const { colors, space, fontSize } = useTheme();
  const { version: synced } = useSync();
  const database = useLocalDatabase();
  const [current] = useState<Month>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const months = useMemo(() => lastMonths(current, MONTHS), [current]);
  const [selected, setSelected] = useState<Month>(current);
  const [flow, setFlow] = useState<MonthFlow[]>([]);
  const [worth, setWorth] = useState<MonthNetWorth[]>([]);
  const [categories, setCategories] = useState<CategorySpend[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (database.status !== "ready" || synced < 0) return;
      let active = true;
      void (async () => {
        const { table } = await copRates(database.db);
        const [f, w, c] = await Promise.all([
          cashFlow(database.db, months, "COP", table),
          netWorthSeries(database.db, months, "COP", table),
          spendingByCategory(database.db, selected, "COP", table),
        ]);
        if (!active) return;
        setFlow(f);
        setWorth(w);
        setCategories(c);
      })();
      return () => {
        active = false;
      };
    }, [database, months, selected, synced]),
  );

  const money = useCallback((m: Money) => formatMoney(m, { locale, discreet }), [locale, discreet]);
  const minor = useCallback((v: bigint) => money(Money.ofMinor(v, "COP")), [money]);
  const labels = months.map((m) => formatMonth(m, locale));
  const series = useMemo(
    () => [
      {
        key: "income",
        name: t("reports.income"),
        color: colors.income,
        values: flow.map((f) => f.income.amountMinor),
      },
      {
        key: "expense",
        name: t("reports.expenses"),
        color: colors.expense,
        values: flow.map((f) => f.expenses.amountMinor),
      },
    ],
    [flow, t, colors],
  );

  /** Tocar una barra abre Movimientos filtrado por ese mes y, si se tocó una barra, ese tipo. */
  const openMonth = (group: number, s: number | null) => {
    const month = months[group];
    if (!month) return;
    const kind = s === 0 ? "income" : s === 1 ? "expense" : undefined;
    router.push({
      pathname: "/(tabs)/transactions",
      params: { month: monthKey(month), ...(kind ? { kind } : {}) },
    });
  };

  if (database.status !== "ready") {
    return (
      <Screen>
        <Title>{t("tabs.reports")}</Title>
        <Body muted>{t("summary.unavailable")}</Body>
      </Screen>
    );
  }

  const top = categories[0]?.spent.amountMinor ?? 0n;
  const flowDetail = flow
    .map((f) =>
      t("reports.monthA11y", {
        month: formatMonth(f.month, locale, "long"),
        income: money(f.income),
        expenses: money(f.expenses),
      }),
    )
    .join(". ");
  const latest = worth.at(-1);

  return (
    <Screen>
      <Title>{t("tabs.reports")}</Title>
      <ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: space.xl }}>
        <Card title={t("reports.cashflow")}>
          <View style={{ flexDirection: "row", gap: space.md }}>
            {series.map((s) => (
              <View
                key={s.key}
                style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}
              >
                <View
                  style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: s.color }}
                />
                <Text style={{ color: colors.text, fontSize: fontSize.caption }}>{s.name}</Text>
              </View>
            ))}
          </View>
          <BarChart
            labels={labels}
            series={series}
            height={CHART_HEIGHT}
            description={t("reports.cashflowA11y", { count: MONTHS, detail: flowDetail })}
            formatValue={minor}
            onSelect={openMonth}
            testID="cashflow"
            gridColor={colors.border}
            textColor={colors.textMuted}
          />
          <Body muted>{t("reports.tapHint")}</Body>
        </Card>

        <Card title={t("reports.byCategory")}>
          <ChipRow>
            {months.map((m) => (
              <Chip
                key={monthKey(m)}
                label={formatMonth(m, locale)}
                selected={monthKey(m) === monthKey(selected)}
                onPress={() => setSelected(m)}
              />
            ))}
          </ChipRow>
          {categories.length === 0 ? (
            <Body muted>
              {t("reports.noSpending", { month: formatMonth(selected, locale, "long") })}
            </Body>
          ) : (
            categories.map((c) => (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityLabel={`${c.name}: ${money(c.spent)}`}
                onPress={() =>
                  router.push({
                    pathname: "/(tabs)/transactions",
                    params: { month: monthKey(selected), category: c.id },
                  })
                }
                style={{ gap: space.xs, paddingVertical: space.xs }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: colors.text, fontSize: fontSize.body }}>
                    {c.icon ? `${c.icon} ${c.name}` : c.name}
                  </Text>
                  <Text style={{ color: colors.text, fontSize: fontSize.body }}>
                    {money(c.spent)}
                  </Text>
                </View>
                <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.border }}>
                  <View
                    style={{
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: colors.expense,
                      width: `${Math.max(2, ratio(c.spent.amountMinor, top) * 100)}%`,
                    }}
                  />
                </View>
              </Pressable>
            ))
          )}
        </Card>

        <Card title={t("reports.netWorth")}>
          {latest ? <Body>{t("reports.netWorthNow", { amount: money(latest.total) })}</Body> : null}
          <LineChart
            labels={labels}
            values={worth.map((w) => w.total.amountMinor)}
            color={colors.primary}
            height={CHART_HEIGHT}
            description={t("reports.netWorthA11y", {
              detail: worth
                .map((w) => `${formatMonth(w.month, locale, "long")}: ${money(w.total)}`)
                .join(". "),
            })}
            formatValue={minor}
            gridColor={colors.border}
            textColor={colors.textMuted}
          />
        </Card>
      </ScrollView>
    </Screen>
  );
}
