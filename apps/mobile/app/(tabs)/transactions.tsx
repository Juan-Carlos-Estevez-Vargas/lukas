import { Body, Screen, Title } from "../../src/components/ui";
import { useI18n } from "../../src/i18n/i18n";

export default function Transactions() {
  const { t } = useI18n();
  return (
    <Screen>
      <Title>{t("tabs.transactions")}</Title>
      <Body muted>{t("transactions.empty")}</Body>
    </Screen>
  );
}
