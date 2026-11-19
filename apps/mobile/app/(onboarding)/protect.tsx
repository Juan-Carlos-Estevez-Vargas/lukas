import { Money } from "@lukas/domain";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView } from "react-native";
import { Body, Button, Screen, Title, Toggle } from "../../src/components/ui";
import { useI18n } from "../../src/i18n/i18n";
import { PinSetup } from "../../src/lock/pin-setup";
import { ONBOARDING_TEMPLATES } from "../../src/onboarding/onboarding";
import { useOnboarding } from "../../src/onboarding/use-onboarding";

export default function Protect() {
  const { t } = useI18n();
  const { complete } = useOnboarding();
  const params = useLocalSearchParams<{ template?: string; balance?: string }>();
  const [sampleData, setSampleData] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = async () => {
    const template =
      ONBOARDING_TEMPLATES.find((tpl) => tpl.key === params.template) ?? ONBOARDING_TEMPLATES[0];
    if (!template) return;
    const parsed = params.balance ? Money.parse(params.balance, "COP") : null;
    setBusy(true);
    setError(null);
    try {
      await complete({
        template,
        openingBalance: parsed?.ok ? parsed.value : null,
        sampleData,
      });
      router.replace("/(tabs)");
    } catch {
      setError(t("onboarding.error"));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 16 }} keyboardShouldPersistTaps="handled">
        <Body muted>{t("onboarding.step", { step: 3 })}</Body>
        <Title>{t("onboarding.protect.title")}</Title>
        <Body>{t("onboarding.protect.body")}</Body>
        <Toggle
          label={t("onboarding.protect.sample")}
          value={sampleData}
          onChange={setSampleData}
        />
        <PinSetup submitLabel={t("onboarding.finish")} onDone={() => void finish()} />
        {error ? <Body tone="error">{error}</Body> : null}
        <Button
          label={t("onboarding.protect.skip")}
          variant="plain"
          busy={busy}
          onPress={() => void finish()}
        />
      </ScrollView>
    </Screen>
  );
}
