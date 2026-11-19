import type { Account } from "@lukas/domain";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView } from "react-native";
import { civilDate } from "../../src/accounts/credit-card";
import { accountErrorKey } from "../../src/accounts/messages";
import { parseAmount } from "../../src/accounts/parse";
import { Chip, ChipRow } from "../../src/components/quick";
import { Body, Button, Field, Screen, Title } from "../../src/components/ui";
import { newId } from "../../src/data/ids";
import { sqliteAccounts } from "../../src/data/ledger-sqlite";
import { useLocalDatabase } from "../../src/data/provider";
import { createGoal } from "../../src/goals/goals";
import { useI18n } from "../../src/i18n/i18n";
import { parseCivil } from "../../src/recurring/recurring";

const SAVING_TYPES = new Set(["bank", "digital_wallet", "investment", "other_asset", "cash"]);

/** Nueva meta: cuánto, para cuándo y, si se quiere, en qué cuenta se ahorra. */
export default function NewGoal() {
  const { t } = useI18n();
  const database = useLocalDatabase();
  const db = database.status === "ready" ? database.db : null;
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [target, setTarget] = useState("");
  const [date, setDate] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!db) return;
    void sqliteAccounts(db)
      .list()
      .then((all) => setAccounts(all.filter((a) => SAVING_TYPES.has(a.type))));
  }, [db]);

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
    const account = accounts.find((a) => a.id === accountId);
    const amount = parseAmount(target, account?.currency ?? "COP");
    if (!amount) return setError(t("movement.error.amount"));
    const targetDate = parseCivil(date);
    if (!targetDate) return setError(t("accounts.error.invalid_date"));
    setBusy(true);
    try {
      const now = new Date();
      const res = await createGoal(
        db,
        { name, icon, target: amount, targetDate, accountId },
        civilDate(now),
        { newId, now: () => now },
      );
      if (!res.ok) return setError(t(accountErrorKey(res.error)));
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
        <Title>{t("goals.new")}</Title>
        <Field label={t("goals.name")} value={name} onChangeText={setName} placeholder="Viaje" />
        <Field label={t("goals.icon")} value={icon} onChangeText={setIcon} maxLength={4} />
        <Field
          label={t("goals.target")}
          value={target}
          onChangeText={setTarget}
          keyboardType="decimal-pad"
          placeholder="3.000.000"
        />
        <Field
          label={t("goals.date")}
          value={date}
          onChangeText={setDate}
          placeholder="2027-06-30"
        />
        <Body muted>{t("goals.account")}</Body>
        <ChipRow>
          <Chip
            label={t("goals.noAccount")}
            selected={accountId === null}
            onPress={() => setAccountId(null)}
          />
          {accounts.map((a) => (
            <Chip
              key={a.id}
              label={a.name}
              selected={a.id === accountId}
              onPress={() => setAccountId(a.id)}
            />
          ))}
        </ChipRow>
        {error ? <Body tone="error">{error}</Body> : null}
        <Button label={t("goals.create")} busy={busy} onPress={() => void save()} />
        <Button label={t("lock.cancel")} variant="plain" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}
