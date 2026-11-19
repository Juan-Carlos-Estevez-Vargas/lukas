import Constants from "expo-constants";
import { useState } from "react";
import { useSession } from "../../src/auth/session";
import { Body, Button, Screen, Title } from "../../src/components/ui";
import { useI18n } from "../../src/i18n/i18n";

export default function Settings() {
  const { t } = useI18n();
  const { signOut } = useSession();
  const [busy, setBusy] = useState(false);
  return (
    <Screen>
      <Title>{t("tabs.settings")}</Title>
      <Button
        label={t("settings.signOut")}
        busy={busy}
        onPress={() => {
          setBusy(true);
          void signOut();
        }}
      />
      <Body muted>{t("settings.version", { version: Constants.expoConfig?.version ?? "?" })}</Body>
    </Screen>
  );
}
