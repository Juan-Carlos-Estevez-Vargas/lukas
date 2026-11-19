import { BUDGET_GROUPS, type BudgetLevel, type Money } from "@lukas/domain";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";
import { civilDate } from "../../src/accounts/credit-card";
import {
  archiveBudget,
  type BudgetView,
  budgetViews,
  type FiftyThirtyTwenty,
  fiftyThirtyTwenty,
} from "../../src/budgets/budgets";
import { Body, Button, Screen, Title } from "../../src/components/ui";
import { newId } from "../../src/data/ids";
import { useLocalDatabase } from "../../src/data/provider";
import { useDiscreet } from "../../src/display/discreet";
import { formatMoney } from "../../src/format/money";
import { useI18n } from "../../src/i18n/i18n";
import { useTheme } from "../../src/theme/theme";

/** Barra de avance; el color cambia al 80 % y al 100 %. */
function Progress({ percent, level }: { readonly percent: number; readonly level: BudgetLevel }) {
  const { colors, radius } = useTheme();
  const color =
    level === "over" ? colors.expense : level === "warning" ? colors.warning : colors.primary;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.min(percent, 100) }}
      style={{ height: 8, borderRadius: radius.md, backgroundColor: colors.border }}
    >
      <View
        style={{
          width: `${Math.min(percent, 100)}%`,
          height: 8,
          borderRadius: radius.md,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

export default function Budgets() {
  const { t, locale } = useI18n();
  const { discreet } = useDiscreet();
  const database = useLocalDatabase();
  const db = database.status === "ready" ? database.db : null;
  const [views, setViews] = useState<BudgetView[]>([]);
  const [rule, setRule] = useState<FiftyThirtyTwenty | null>(null);

  const load = useCallback(async () => {
    if (!db) return;
    const today = civilDate(new Date());
    setViews(await budgetViews(db, today));
    setRule(await fiftyThirtyTwenty(db, today, "COP"));
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!db) {
    return (
      <Screen>
        <Title>{t("tabs.budgets")}</Title>
        <Body muted>{t("summary.unavailable")}</Body>
      </Screen>
    );
  }

  const money = (m: Money) => formatMoney(m, { locale, discreet });
  const percentOf = (part: Money, whole: Money) =>
    whole.amountMinor > 0n ? Number((part.amountMinor * 100n) / whole.amountMinor) : 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 16 }}>
        <Title>{t("tabs.budgets")}</Title>
        {views.length === 0 ? <Body muted>{t("budgets.empty")}</Body> : null}
        {views.map(({ budget, category, status }) => (
          <View key={budget.id} style={{ gap: 6 }}>
            <Body>
              {`${category ? `${category.icon ?? ""} ${category.name}`.trim() : t("budgets.general")} · ${t(`budgets.period.${budget.period}`)}`}
            </Body>
            <Progress percent={status.percent} level={status.level} />
            <Body muted>
              {`${t("budgets.spent", { spent: money(status.spent), available: money(status.available) })} · ${
                status.remaining.isNegative()
                  ? t("budgets.overBy", { amount: money(status.remaining.negate()) })
                  : t("budgets.left", { amount: money(status.remaining) })
              }`}
            </Body>
            {budget.rollover && !status.carried.isZero() ? (
              <Body muted>{t("budgets.carried", { amount: money(status.carried) })}</Body>
            ) : null}
            <Button
              label={t("budgets.archive")}
              variant="plain"
              onPress={() =>
                void archiveBudget(db, budget.id, { newId, now: () => new Date() }).then(load)
              }
            />
          </View>
        ))}
        <Button label={t("budgets.new")} onPress={() => router.push("/budgets/new")} />

        <Title>{t("budgets.rule.title")}</Title>
        <Body muted>{t("budgets.rule.body")}</Body>
        {rule && rule.income.amountMinor > 0n ? (
          <>
            <Body>{t("budgets.rule.income", { amount: money(rule.income) })}</Body>
            {BUDGET_GROUPS.map((g) => {
              const percent = percentOf(rule.actual[g], rule.targets[g]);
              // En ahorro, quedarse corto es lo malo; en necesidades y gustos, pasarse.
              const level: BudgetLevel =
                g === "savings"
                  ? percent >= 100
                    ? "ok"
                    : "warning"
                  : percent >= 100
                    ? "over"
                    : percent >= 80
                      ? "warning"
                      : "ok";
              return (
                <View key={g} style={{ gap: 6 }}>
                  <Body>
                    {`${t(`budgets.group.${g}`)}: ${t("budgets.rule.row", {
                      actual: money(rule.actual[g]),
                      target: money(rule.targets[g]),
                    })}`}
                  </Body>
                  <Progress percent={Math.max(percent, 0)} level={level} />
                </View>
              );
            })}
            {!rule.unassigned.isZero() ? (
              <Body muted>{t("budgets.rule.unassigned", { amount: money(rule.unassigned) })}</Body>
            ) : null}
          </>
        ) : (
          <Body muted>{t("budgets.rule.noIncome")}</Body>
        )}
        <Button
          label={t("budgets.groups.manage")}
          variant="plain"
          onPress={() => router.push("/budgets/groups")}
        />
      </ScrollView>
    </Screen>
  );
}
