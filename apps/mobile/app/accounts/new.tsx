import type { CurrencyCode } from "@lukas/domain";
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView } from "react-native";
import { createFromTemplate } from "../../src/accounts/accounts";
import { accountErrorKey } from "../../src/accounts/messages";
import { parseAmount } from "../../src/accounts/parse";
import { ACCOUNT_TEMPLATES, type AccountTemplate } from "../../src/accounts/templates";
import { Chip, ChipRow } from "../../src/components/quick";
import { Body, Button, Choice, Field, Screen, Title } from "../../src/components/ui";
import { newId } from "../../src/data/ids";
import { useLocalDatabase } from "../../src/data/provider";
import { useI18n } from "../../src/i18n/i18n";

/** Monedas ofrecidas al crear una cuenta; las tarjetas siguen en pesos. */
const CURRENCIES: readonly CurrencyCode[] = ["COP", "USD", "EUR"];

/** Un toque sobre una plantilla crea la cuenta. Nombre y saldo son opcionales. */
export default function NewAccount() {
  const { t } = useI18n();
  const database = useLocalDatabase();
  const [name, setName] = useState("");
  const [balance, setBalance] = useState("");
  const [currency, setCurrency] = useState<CurrencyCode>("COP");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (template: AccountTemplate) => {
    if (template.type === "credit_card") return router.push("/accounts/new-card");
    if (database.status !== "ready" || busy) return;
    const openingBalance = parseAmount(balance, currency);
    if (openingBalance === undefined) return setError(t("onboarding.account.invalidBalance"));
    setBusy(true);
    setError(null);
    try {
      const res = await createFromTemplate(
        database.db,
        template,
        { name, openingBalance, currency },
        { newId, now: () => new Date() },
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
      <ScrollView contentContainerStyle={{ gap: 16 }} keyboardShouldPersistTaps="handled">
        <Title>{t("accounts.new.title")}</Title>
        <Body muted>{t("accounts.new.body")}</Body>
        <Field label={t("accounts.name")} value={name} onChangeText={setName} />
        <Field
          label={t("onboarding.account.balance")}
          value={balance}
          onChangeText={setBalance}
          keyboardType="numbers-and-punctuation"
          placeholder="150.000"
        />
        <ChipRow>
          {CURRENCIES.map((c) => (
            <Chip key={c} label={c} selected={currency === c} onPress={() => setCurrency(c)} />
          ))}
        </ChipRow>
        {error ? <Body tone="error">{error}</Body> : null}
        {ACCOUNT_TEMPLATES.map((tpl) => (
          <Choice
            key={tpl.key}
            label={tpl.name}
            selected={false}
            onPress={() => void create(tpl)}
          />
        ))}
        <Button label={t("lock.cancel")} variant="plain" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}
