import type { Money } from "@lukas/domain";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView } from "react-native";
import { civilDate } from "../../src/accounts/credit-card";
import { accountErrorKey } from "../../src/accounts/messages";
import { parseAmount } from "../../src/accounts/parse";
import { Progress } from "../../src/components/progress";
import { Body, Button, Field, Screen, Title } from "../../src/components/ui";
import { newId } from "../../src/data/ids";
import { sqliteAccounts } from "../../src/data/ledger-sqlite";
import { useLocalDatabase } from "../../src/data/provider";
import { useDiscreet } from "../../src/display/discreet";
import { formatCivilDate } from "../../src/format/date";
import { formatMoney } from "../../src/format/money";
import { archiveGoal, contributeToGoal, type GoalView, goalView } from "../../src/goals/goals";
import { goalLine } from "../../src/goals/text";
import { useI18n } from "../../src/i18n/i18n";

const clock = { newId, now: () => new Date() };

/** Detalle de la meta: avance, cuánto apartar y abonos. */
export default function GoalDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { discreet } = useDiscreet();
  const database = useLocalDatabase();
  const db = database.status === "ready" ? database.db : null;
  const [view, setView] = useState<GoalView | null | undefined>(undefined);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!db || !id) return;
    const v = await goalView(db, id, civilDate(new Date()));
    setView(v);
    if (v?.goal.accountId) {
      setAccountName((await sqliteAccounts(db).get(v.goal.accountId))?.name ?? null);
    }
  }, [db, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!db || view === null) {
    return (
      <Screen>
        <Body muted>{t(db ? "goals.notFound" : "summary.unavailable")}</Body>
      </Screen>
    );
  }
  if (view === undefined) return <Screen>{null}</Screen>;

  const { goal, progress } = view;
  const money = (m: Money) => formatMoney(m, { locale, discreet });

  const move = async (sign: 1n | -1n) => {
    setError(null);
    const parsed = parseAmount(amount, goal.target.currencyCode);
    if (!parsed) return setError(t("movement.error.amount"));
    const res = await contributeToGoal(db, goal.id, sign === 1n ? parsed : parsed.negate(), clock);
    if (!res.ok) return setError(t(accountErrorKey(res.error)));
    setAmount("");
    await load();
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
        <Title>{goal.icon ? `${goal.icon} ${goal.name}` : goal.name}</Title>
        <Progress percent={progress.percent} level={progress.overdue ? "warning" : "ok"} />
        <Body>
          {t("goals.progress", {
            saved: money(progress.saved),
            target: money(goal.target),
            percent: String(progress.percent),
          })}
        </Body>
        <Body>{goalLine(progress, t, money)}</Body>
        <Body muted>{t("goals.until", { date: formatCivilDate(goal.targetDate, locale) })}</Body>

        {goal.accountId ? (
          <Body muted>{t("goals.viaAccount", { account: accountName ?? "" })}</Body>
        ) : (
          <>
            <Field
              label={t("goals.contribution")}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
            />
            <Button label={t("goals.contribute")} onPress={() => void move(1n)} />
            <Button label={t("goals.withdraw")} variant="plain" onPress={() => void move(-1n)} />
          </>
        )}
        {error ? <Body tone="error">{error}</Body> : null}
        <Button
          label={t("goals.archive")}
          variant="plain"
          onPress={() => void archiveGoal(db, goal.id, clock).then(() => router.back())}
        />
      </ScrollView>
    </Screen>
  );
}
