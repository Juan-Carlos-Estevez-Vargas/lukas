import { ratio } from "@lukas/charts";
import { Money } from "@lukas/domain";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, type ScrollViewInstance, Text, View } from "react-native";
import { BarChart } from "../../src/charts/bar-chart";
import { HeatmapChart } from "../../src/charts/heatmap-chart";
import { LineChart } from "../../src/charts/line-chart";
import { SankeyChart, type SankeyItem } from "../../src/charts/sankey-chart";
import { Chip, ChipRow } from "../../src/components/quick";
import { Body, Button, Screen, Title } from "../../src/components/ui";
import { newId } from "../../src/data/ids";
import { sqlitePreferences } from "../../src/data/preferences";
import { useLocalDatabase } from "../../src/data/provider";
import { useDiscreet } from "../../src/display/discreet";
import { ExportButtons } from "../../src/export/export-buttons";
import { formatCivilDate, formatMonth, formatShortDate } from "../../src/format/date";
import { formatMoney } from "../../src/format/money";
import type { CategorySpend } from "../../src/home/home";
import { Card } from "../../src/home/home-cards";
import { useI18n } from "../../src/i18n/i18n";
import {
  type AccountProjection,
  projectAccounts,
  todayCivil,
} from "../../src/projection/projection";
import { copRates } from "../../src/rates/rates";
import {
  baseMonth,
  type CompareBase,
  compareMonths,
  dailySpending,
  type MoneyFlow,
  type MonthComparison,
  moneyFlow,
} from "../../src/reports/advanced";
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
import { loadViews, removeView, type SavedView, saveView } from "../../src/reports/views";
import { useSync } from "../../src/sync/use-sync";
import { useTheme } from "../../src/theme/theme";

const MONTHS = 6;
const CHART_HEIGHT = 160;
const SANKEY_HEIGHT = 220;
/** Colores de las categorías en el Sankey, en orden; se repiten si hay más. */
/** La proyección se dibuja con un punto cada tantos días (0, 10, …, 90). */
const PROJECTION_STEP = 10;
const PALETTE = ["#2E7D9A", "#B0532F", "#6B5BA8", "#3F8A4A", "#A0662B", "#8A4F7D", "#4D6A8F"];

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
  const [base, setBase] = useState<CompareBase>("previous");
  const [focus, setFocus] = useState<string | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [views, setViews] = useState<SavedView[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [flow, setFlow] = useState<MonthFlow[]>([]);
  const [worth, setWorth] = useState<MonthNetWorth[]>([]);
  const [categories, setCategories] = useState<CategorySpend[]>([]);
  const [comparison, setComparison] = useState<MonthComparison | null>(null);
  const [sankey, setSankey] = useState<MoneyFlow | null>(null);
  const [daily, setDaily] = useState<bigint[]>([]);
  const [projections, setProjections] = useState<AccountProjection[]>([]);
  const params = useLocalSearchParams<{ account?: string }>();
  const [projected, setProjected] = useState<string | null>(params.account ?? null);
  const scroll = useRef<ScrollViewInstance>(null);
  const [projectionY, setProjectionY] = useState<number | null>(null);
  useEffect(() => {
    if (params.account) setProjected(params.account);
  }, [params.account]);
  useEffect(() => {
    // Desde el aviso del Resumen se llega directo a la proyección.
    if (params.account && projectionY !== null) scroll.current?.scrollTo({ y: projectionY });
  }, [params.account, projectionY]);

  const prefs = useMemo(
    () => (database.status === "ready" ? sqlitePreferences(database.db) : null),
    [database],
  );
  useEffect(() => {
    if (prefs) void loadViews(prefs).then(setViews);
  }, [prefs]);

  useFocusEffect(
    useCallback(() => {
      if (database.status !== "ready" || synced < 0) return;
      let active = true;
      void (async () => {
        const { table } = await copRates(database.db);
        const [f, w, c, cmp, s, d, p] = await Promise.all([
          cashFlow(database.db, months, "COP", table),
          netWorthSeries(database.db, months, "COP", table),
          spendingByCategory(database.db, selected, "COP", table),
          compareMonths(database.db, selected, baseMonth(selected, base), "COP", table),
          moneyFlow(database.db, selected, "COP", table),
          dailySpending(database.db, selected, "COP", table),
          projectAccounts(database.db, todayCivil()),
        ]);
        if (!active) return;
        setFlow(f);
        setWorth(w);
        setCategories(c);
        setComparison(cmp);
        setSankey(s);
        setDaily(d);
        setProjections(p);
      })();
      return () => {
        active = false;
      };
    }, [database, months, selected, base, synced]),
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
  const sankeyItems = useMemo(() => {
    if (!sankey) return { sources: [], targets: [] };
    const sources: SankeyItem[] = sankey.income.map((c, i) => ({
      key: `in:${c.id}`,
      label: c.name,
      color: i === 0 ? colors.income : (PALETTE[i % PALETTE.length] ?? colors.income),
      value: c.amount.amountMinor,
    }));
    if (sankey.deficit.amountMinor > 0n)
      sources.push({
        key: "deficit",
        label: t("reports.deficit"),
        color: colors.expense,
        value: sankey.deficit.amountMinor,
      });
    const targets: SankeyItem[] = sankey.expenses.map((c, i) => ({
      key: `out:${c.id}`,
      label: c.name,
      color: PALETTE[i % PALETTE.length] ?? colors.expense,
      value: c.amount.amountMinor,
    }));
    if (sankey.savings.amountMinor > 0n)
      targets.push({
        key: "savings",
        label: t("reports.savings"),
        color: colors.income,
        value: sankey.savings.amountMinor,
      });
    return { sources, targets };
  }, [sankey, colors, t]);

  const pickMonth = (m: Month) => {
    setSelected(m);
    setDay(null);
  };

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

  if (database.status !== "ready" || !prefs) {
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
  const selectedLong = formatMonth(selected, locale, "long");
  const beforeLong = formatMonth(baseMonth(selected, base), locale, "long");
  const baseLabel = (b: CompareBase) =>
    t(b === "previous" ? "reports.base.previous" : "reports.base.lastYear");
  const changeText = (m: Money) =>
    m.amountMinor > 0n
      ? t("reports.more", { amount: money(m) })
      : m.amountMinor < 0n
        ? t("reports.less", { amount: money(m.negate()) })
        : t("reports.same");
  const shown = (comparison?.categories ?? []).filter((c) => focus === null || c.id === focus);
  const focusName = comparison?.categories.find((c) => c.id === focus)?.name;
  const peak = daily.reduce<{ day: number; value: bigint }>(
    (best, v, i) => (v > best.value ? { day: i + 1, value: v } : best),
    { day: 0, value: 0n },
  );
  const weekdays = t("reports.weekdays").split(",");
  const projection = projections.find((p) => p.id === projected) ?? projections[0] ?? null;
  const projectionMoney = (v: bigint) =>
    projection ? money(Money.ofMinor(v, projection.currency)) : "";
  const samples = (projection?.points ?? []).filter((_, i) => i % PROJECTION_STEP === 0);

  const applyView = (v: SavedView) => {
    setBase(v.base);
    setFocus(v.categoryId);
    setNotice(null);
  };
  const saveCurrent = async () => {
    const label = t(
      base === "previous" ? "reports.viewName.previous" : "reports.viewName.lastYear",
    );
    const name = focusName ? `${label} · ${focusName}` : label;
    setViews(await saveView(prefs, { name, base, categoryId: focus }, newId));
  };
  const deleteView = async (v: SavedView) => {
    setViews(await removeView(prefs, v.id));
    setNotice(t("reports.viewDeleted", { name: v.name }));
  };

  return (
    <Screen>
      <Title>{t("tabs.reports")}</Title>
      <ScrollView ref={scroll} contentContainerStyle={{ gap: space.md, paddingBottom: space.xl }}>
        <ChipRow testID="report-months">
          {months.map((m) => (
            <Chip
              key={monthKey(m)}
              label={formatMonth(m, locale)}
              selected={monthKey(m) === monthKey(selected)}
              onPress={() => pickMonth(m)}
            />
          ))}
        </ChipRow>
        {database.status === "ready" ? <ExportButtons db={database.db} month={selected} /> : null}

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

        <Card title={t("reports.compareTitle", { current: selectedLong, before: beforeLong })}>
          <ChipRow testID="compare-base">
            {(["previous", "lastYear"] as const).map((b) => (
              <Chip key={b} label={baseLabel(b)} selected={b === base} onPress={() => setBase(b)} />
            ))}
          </ChipRow>
          {comparison && comparison.categories.length > 0 ? (
            <>
              <Body>
                {t("reports.compareTotal", {
                  current: money(comparison.totalCurrent),
                  before: beforeLong,
                  amount: money(comparison.totalBefore),
                })}{" "}
                {changeText(comparison.totalCurrent.subtract(comparison.totalBefore))}
              </Body>
              {focus !== null ? (
                <ChipRow>
                  <Chip
                    label={`${t("reports.onlyCategory", { name: focusName ?? "" })} ✕`}
                    selected
                    onPress={() => setFocus(null)}
                  />
                </ChipRow>
              ) : null}
              {shown.map((c) => {
                const up = c.change.amountMinor > 0n;
                const down = c.change.amountMinor < 0n;
                return (
                  <Pressable
                    key={c.id}
                    accessibilityRole="button"
                    accessibilityLabel={t("reports.changeA11y", {
                      name: c.name,
                      current: money(c.current),
                      before: money(c.before),
                      change: changeText(c.change),
                    })}
                    onPress={() => setFocus(focus === c.id ? null : c.id)}
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      paddingVertical: space.xs,
                      gap: space.sm,
                    }}
                  >
                    <Text style={{ color: colors.text, fontSize: fontSize.body, flexShrink: 1 }}>
                      {c.icon ? `${c.icon} ${c.name}` : c.name}
                    </Text>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ color: colors.text, fontSize: fontSize.body }}>
                        {money(c.current)}
                      </Text>
                      <Text
                        style={{
                          color: up ? colors.expense : down ? colors.income : colors.textMuted,
                          fontSize: fontSize.caption,
                        }}
                      >
                        {`${up ? "▲" : down ? "▼" : "="} ${changeText(c.change)}`}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </>
          ) : (
            <Body muted>{t("reports.noCompare")}</Body>
          )}
          {views.length > 0 ? (
            <>
              <Body muted>{t("reports.savedViews")}</Body>
              <ChipRow testID="saved-views">
                {views.map((v) => (
                  <Chip
                    key={v.id}
                    label={v.name}
                    selected={v.base === base && v.categoryId === focus}
                    onPress={() => applyView(v)}
                    onLongPress={() => void deleteView(v)}
                    hint={t("reports.viewHint")}
                  />
                ))}
              </ChipRow>
            </>
          ) : null}
          {notice ? <Body muted>{notice}</Body> : null}
          <Button
            label={t("reports.saveView")}
            variant="plain"
            onPress={() => void saveCurrent()}
          />
        </Card>

        <Card title={t("reports.flow")}>
          {sankeyItems.sources.length > 0 || sankeyItems.targets.length > 0 ? (
            <SankeyChart
              sources={sankeyItems.sources}
              targets={sankeyItems.targets}
              totalColor={colors.primary}
              height={SANKEY_HEIGHT}
              textColor={colors.text}
              description={t("reports.flowA11y", {
                income: money(
                  (sankey?.income ?? []).reduce((s, c) => s.add(c.amount), Money.zero("COP")),
                ),
                expenses: money(
                  (sankey?.expenses ?? []).reduce((s, c) => s.add(c.amount), Money.zero("COP")),
                ),
                month: selectedLong,
                detail: [...sankeyItems.sources, ...sankeyItems.targets]
                  .map((i) => `${i.label}: ${minor(i.value)}`)
                  .join(". "),
              })}
            />
          ) : (
            <Body muted>{t("reports.noFlow", { month: selectedLong })}</Body>
          )}
        </Card>

        <Card title={t("reports.daily")}>
          <HeatmapChart
            year={selected.year}
            month={selected.month}
            values={daily}
            weekdays={weekdays}
            color={colors.expense}
            emptyColor={colors.border}
            textColor={colors.text}
            strongTextColor={colors.surface}
            selected={day}
            onSelect={setDay}
            testID="daily-heatmap"
            description={t("reports.dailyA11y", {
              month: selectedLong,
              day: peak.day,
              amount: minor(peak.value),
            })}
          />
          <Body muted>
            {day
              ? t("reports.dayDetail", {
                  date: `${day} ${formatMonth(selected, locale)}`,
                  amount: minor(daily[day - 1] ?? 0n),
                })
              : t("reports.dailyHint")}
          </Body>
        </Card>

        <Card title={t("reports.byCategory")}>
          {categories.length === 0 ? (
            <Body muted>{t("reports.noSpending", { month: selectedLong })}</Body>
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

        <View onLayout={(e) => setProjectionY(e.nativeEvent.layout.y)}>
          <Card title={t("projection.title")}>
            {projection ? (
              <>
                {projections.length > 1 ? (
                  <ChipRow testID="projection-accounts">
                    {projections.map((p) => (
                      <Chip
                        key={p.id}
                        label={p.firstNegative ? `⚠ ${p.name}` : p.name}
                        selected={p.id === projection.id}
                        onPress={() => setProjected(p.id)}
                      />
                    ))}
                  </ChipRow>
                ) : null}
                {projection.firstNegative ? (
                  <Text style={{ color: colors.warning, fontSize: fontSize.body }}>
                    {`⚠ ${t("projection.negative", {
                      date: formatCivilDate(projection.firstNegative.date, locale),
                    })}`}
                  </Text>
                ) : null}
                <Body>
                  {t("projection.lowest", {
                    today: money(projection.today),
                    amount: projectionMoney(projection.lowest?.balance ?? 0n),
                    date: projection.lowest ? formatCivilDate(projection.lowest.date, locale) : "",
                  })}
                </Body>
                <LineChart
                  labels={samples.map((p, i) =>
                    i === 0 ? t("projection.today") : formatShortDate(p.date, locale),
                  )}
                  labelEvery={3}
                  values={samples.map((p) => p.balance)}
                  color={projection.firstNegative ? colors.expense : colors.primary}
                  height={CHART_HEIGHT}
                  description={t("projection.a11y", {
                    account: projection.name,
                    detail: samples
                      .map(
                        (p) => `${formatCivilDate(p.date, locale)}: ${projectionMoney(p.balance)}`,
                      )
                      .join(". "),
                  })}
                  formatValue={projectionMoney}
                  gridColor={colors.border}
                  textColor={colors.textMuted}
                />
                <Body muted>
                  {projection.dailyAverage.amountMinor < 0n
                    ? t("projection.averageOut", {
                        amount: money(projection.dailyAverage.negate()),
                      })
                    : t("projection.averageIn", { amount: money(projection.dailyAverage) })}
                </Body>
                {projection.scheduled.length > 0 ? (
                  <>
                    <Body muted>{t("projection.next")}</Body>
                    {projection.scheduled.slice(0, 5).map((f) => (
                      <View
                        key={`${f.name}-${formatShortDate(f.date, locale)}`}
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          gap: space.sm,
                        }}
                      >
                        <Text
                          style={{ color: colors.text, fontSize: fontSize.body, flexShrink: 1 }}
                        >
                          {`${formatShortDate(f.date, locale)} · ${f.name}`}
                        </Text>
                        <Text
                          style={{
                            color: f.amount < 0n ? colors.expense : colors.income,
                            fontSize: fontSize.body,
                          }}
                        >
                          {projectionMoney(f.amount)}
                        </Text>
                      </View>
                    ))}
                  </>
                ) : null}
                <Body muted>{t("projection.how")}</Body>
              </>
            ) : (
              <Body muted>{t("projection.empty")}</Body>
            )}
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}
