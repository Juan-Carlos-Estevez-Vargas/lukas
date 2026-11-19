import { Body, Screen, Title } from "../../src/components/ui";
import { useI18n } from "../../src/i18n/i18n";

export default function Summary() {
  const { t } = useI18n();
  return (
    <Screen>
      <Title>{t("tabs.summary")}</Title>
      <Body muted>{t("summary.empty")}</Body>
    </Screen>
  );
}
