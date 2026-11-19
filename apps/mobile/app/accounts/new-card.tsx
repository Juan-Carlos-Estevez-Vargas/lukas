import { router } from "expo-router";
import { useState } from "react";
import { ScrollView } from "react-native";
import { createFromTemplate } from "../../src/accounts/accounts";
import { parseDay } from "../../src/accounts/credit-card";
import { accountErrorKey } from "../../src/accounts/messages";
import { parsePesos } from "../../src/accounts/parse";
import { templateByKey } from "../../src/accounts/templates";
import { Body, Button, Field, Screen, Title } from "../../src/components/ui";
import { newId } from "../../src/data/ids";
import { useLocalDatabase } from "../../src/data/provider";
import { useI18n } from "../../src/i18n/i18n";
import { useCardReminders } from "../../src/reminders/use-card-reminders";

/** Tarjeta de crédito: cupo, corte, pago y deuda actual. Nunca el número de la tarjeta. */
export default function NewCard() {
  const { t } = useI18n();
  const database = useLocalDatabase();
  const reminders = useCardReminders();
  const [name, setName] = useState("");
  const [limit, setLimit] = useState("");
  const [closing, setClosing] = useState("");
  const [due, setDue] = useState("");
  const [debt, setDebt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const template = templateByKey("credit_card");
    if (database.status !== "ready" || busy || !template) return;
    const creditLimit = parsePesos(limit);
    const owed = parsePesos(debt);
    if (creditLimit === undefined || owed === undefined) return setError(t("card.invalidAmount"));
    const closingDay = parseDay(closing);
    const dueDay = parseDay(due);
    if (closingDay === undefined || dueDay === undefined) {
      return setError(t("accounts.error.invalid_day"));
    }
    setBusy(true);
    setError(null);
    try {
      const res = await createFromTemplate(
        database.db,
        template,
        // La deuda se escribe en positivo; en el libro es saldo negativo de la tarjeta.
        { name, openingBalance: owed?.negate() ?? null, card: { creditLimit, closingDay, dueDay } },
        { newId, now: () => new Date() },
      );
      if (!res.ok) return setError(t(accountErrorKey(res.error)));
      reminders.resync();
      router.dismissTo("/");
    } catch {
      setError(t("accounts.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 16 }} keyboardShouldPersistTaps="handled">
        <Title>{t("card.new.title")}</Title>
        <Body muted>{t("card.new.body")}</Body>
        <Field label={t("accounts.name")} value={name} onChangeText={setName} placeholder="Visa" />
        <Field
          label={t("card.limit")}
          value={limit}
          onChangeText={setLimit}
          keyboardType="number-pad"
          placeholder="5.000.000"
        />
        <Field
          label={t("card.closingDay")}
          value={closing}
          onChangeText={setClosing}
          keyboardType="number-pad"
          maxLength={2}
        />
        <Field
          label={t("card.dueDay")}
          value={due}
          onChangeText={setDue}
          keyboardType="number-pad"
          maxLength={2}
        />
        <Field
          label={t("card.debt")}
          value={debt}
          onChangeText={setDebt}
          keyboardType="number-pad"
          placeholder="0"
        />
        {error ? <Body tone="error">{error}</Body> : null}
        <Button label={t("card.create")} busy={busy} onPress={() => void create()} />
        <Button label={t("lock.cancel")} variant="plain" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}
