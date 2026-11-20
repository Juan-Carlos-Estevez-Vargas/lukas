import { BUDGET_PERIODS, type BudgetPeriod } from "@lukas/domain";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView } from "react-native";
import { civilDate } from "../../src/accounts/credit-card";
import { accountErrorKey } from "../../src/accounts/messages";
import { parseAmount } from "../../src/accounts/parse";
import { categoryGroups, createBudget, type GroupedCategory } from "../../src/budgets/budgets";
import { useBudgetAlerts } from "../../src/budgets/use-budget-alerts";
import { Chip, ChipRow } from "../../src/components/quick";
import { Body, Button, Field, Screen, Title, Toggle } from "../../src/components/ui";
import { newId } from "../../src/data/ids";
import { useLocalDatabase } from "../../src/data/provider";
import { useI18n } from "../../src/i18n/i18n";
import { notificationScheduler } from "../../src/reminders/notifications";

/** Nuevo presupuesto: de una categoría (o de todo), por semana, mes o año, normal o sobre. */
export default function NewBudget() {
  const { t } = useI18n();
  const database = useLocalDatabase();
  const alerts = useBudgetAlerts();
  const db = database.status === "ready" ? database.db : null;
  // "Editar" en una propuesta del asistente abre el formulario con `?category=…&amount=…`.
  const params = useLocalSearchParams<{ category?: string; amount?: string }>();
  const [categories, setCategories] = useState<GroupedCategory[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [period, setPeriod] = useState<BudgetPeriod>("monthly");
  const [amount, setAmount] = useState(params.amount?.slice(0, 20) ?? "");
  const [rollover, setRollover] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!db) return;
    const wanted = params.category;
    void categoryGroups(db).then((list) => {
      setCategories(list);
      if (wanted && list.some((c) => c.id === wanted)) setCategoryId(wanted);
    });
  }, [db, params.category]);

  if (!db) {
    return (
      <Screen>
        <Body muted>{t("summary.unavailable")}</Body>
      </Screen>
    );
  }

  const save = async () => {
    if (busy) return;
    setError(null);
    const money = parseAmount(amount, "COP");
    if (!money) return setError(t("movement.error.amount"));
    setBusy(true);
    try {
      const now = new Date();
      const res = await createBudget(
        db,
        { categoryId, period, amount: money, rollover },
        civilDate(now),
        { newId, now: () => now },
      );
      if (!res.ok) return setError(t(accountErrorKey(res.error)));
      if (notificationScheduler.available) await notificationScheduler.ensurePermission();
      alerts.check();
      router.back();
    } catch {
      setError(t("accounts.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
        <Title>{t("budgets.new")}</Title>
        <Body muted>{t("budgets.category")}</Body>
        <ChipRow>
          <Chip
            label={t("budgets.general")}
            selected={categoryId === null}
            onPress={() => setCategoryId(null)}
          />
          {categories
            .filter((c) => c.parentId === null)
            .map((c) => (
              <Chip
                key={c.id}
                label={c.icon ? `${c.icon} ${c.name}` : c.name}
                selected={c.id === categoryId}
                onPress={() => setCategoryId(c.id)}
              />
            ))}
        </ChipRow>
        <ChipRow>
          {BUDGET_PERIODS.map((p) => (
            <Chip
              key={p}
              label={t(`budgets.period.${p}`)}
              selected={p === period}
              onPress={() => setPeriod(p)}
            />
          ))}
        </ChipRow>
        <Field
          label={t("budgets.amount")}
          value={amount}
          onChangeText={setAmount}
          keyboardType="number-pad"
          placeholder="800.000"
        />
        <Toggle label={t("budgets.rollover")} value={rollover} onChange={setRollover} />
        {error ? <Body tone="error">{error}</Body> : null}
        <Button label={t("budgets.create")} busy={busy} onPress={() => void save()} />
        <Button label={t("lock.cancel")} variant="plain" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}
