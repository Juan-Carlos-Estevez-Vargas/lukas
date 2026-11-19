import { Body, Screen, Title } from "../../src/components/ui";
import { useI18n } from "../../src/i18n/i18n";

export default function Budgets() {
  const { t } = useI18n();
  return (
    <Screen>
      <Title>{t("tabs.budgets")}</Title>
      <Body muted>{t("budgets.empty")}</Body>
    </Screen>
  );
}
