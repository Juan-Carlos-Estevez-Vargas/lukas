import { router } from "expo-router";
import { Body, Button, Screen, Title } from "../../src/components/ui";
import { useI18n } from "../../src/i18n/i18n";

export default function Welcome() {
  const { t } = useI18n();
  return (
    <Screen>
      <Body muted>{t("onboarding.step", { step: 1 })}</Body>
      <Title>{t("onboarding.welcome.title")}</Title>
      <Body>{t("onboarding.welcome.body")}</Body>
      <Button
        label={t("onboarding.welcome.start")}
        onPress={() => router.push("/(onboarding)/account")}
      />
    </Screen>
  );
}
