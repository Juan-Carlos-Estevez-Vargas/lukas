import { router } from "expo-router";
import { Fab } from "../../src/components/quick";
import { Body, Screen, Title } from "../../src/components/ui";
import { useLocalDatabase } from "../../src/data/provider";
import { useI18n } from "../../src/i18n/i18n";

export default function Transactions() {
  const { t } = useI18n();
  const database = useLocalDatabase();
  return (
    <Screen>
      <Title>{t("tabs.transactions")}</Title>
      <Body muted>{t("transactions.empty")}</Body>
      {database.status === "ready" ? (
        <Fab label={t("movement.add")} onPress={() => router.push("/movement/new")} />
      ) : null}
    </Screen>
  );
}
