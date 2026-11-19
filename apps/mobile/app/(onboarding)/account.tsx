import { Money } from "@lukas/domain";
import { router } from "expo-router";
import { useState } from "react";
import { Body, Button, Choice, Field, Screen, Title } from "../../src/components/ui";
import { useI18n } from "../../src/i18n/i18n";
import { ONBOARDING_TEMPLATES } from "../../src/onboarding/onboarding";

export default function FirstAccount() {
  const { t } = useI18n();
  const [template, setTemplate] = useState<string>("nequi");
  const [balance, setBalance] = useState("");
  const [error, setError] = useState<string | null>(null);

  const next = () => {
    // Pesos enteros; los puntos de miles se ignoran ("150.000" = 150000).
    const text = balance.replace(/\./g, "").trim();
    if (text !== "" && !Money.parse(text, "COP").ok) {
      return setError(t("onboarding.account.invalidBalance"));
    }
    router.push({ pathname: "/(onboarding)/protect", params: { template, balance: text } });
  };

  return (
    <Screen>
      <Body muted>{t("onboarding.step", { step: 2 })}</Body>
      <Title>{t("onboarding.account.title")}</Title>
      <Body>{t("onboarding.account.body")}</Body>
      {ONBOARDING_TEMPLATES.map((tpl) => (
        <Choice
          key={tpl.key}
          label={tpl.name}
          selected={template === tpl.key}
          onPress={() => setTemplate(tpl.key)}
        />
      ))}
      <Field
        testID="onboarding-balance"
        label={t("onboarding.account.balance")}
        value={balance}
        onChangeText={setBalance}
        keyboardType="number-pad"
        placeholder="150.000"
      />
      {error ? <Body tone="error">{error}</Body> : null}
      <Button label={t("onboarding.next")} onPress={next} />
    </Screen>
  );
}
