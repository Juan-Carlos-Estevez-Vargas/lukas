import Constants from "expo-constants";
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView } from "react-native";
import { useSession } from "../../src/auth/session";
import { Body, Button, Screen, Title, Toggle } from "../../src/components/ui";
import { useLocalDatabase } from "../../src/data/provider";
import { useDiscreet } from "../../src/display/discreet";
import { useI18n } from "../../src/i18n/i18n";
import { useAppLock } from "../../src/lock/app-lock";
import { lockStore } from "../../src/lock/lock-store";
import { PinSetup } from "../../src/lock/pin-setup";
import { removeSampleData } from "../../src/onboarding/onboarding";
import { useCardReminders } from "../../src/reminders/use-card-reminders";
import { syncLine as describeSync } from "../../src/sync/text";
import { useSync } from "../../src/sync/use-sync";

export default function Settings() {
  const { t, locale } = useI18n();
  const { signOut } = useSession();
  const sync = useSync();
  const syncLine = describeSync(t, locale, sync);
  const { discreet, setDiscreet } = useDiscreet();
  const lock = useAppLock();
  const database = useLocalDatabase();
  const [busy, setBusy] = useState(false);
  const [settingPin, setSettingPin] = useState(false);
  const reminders = useCardReminders();
  const [reminderError, setReminderError] = useState(false);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 16 }} keyboardShouldPersistTaps="handled">
        <Title>{t("tabs.settings")}</Title>
        <Toggle label={t("settings.discreet")} value={discreet} onChange={setDiscreet} />
        {reminders.available ? (
          <Toggle
            label={t("card.reminders")}
            value={reminders.enabled}
            onChange={(on) => void reminders.setEnabled(on).then((ok) => setReminderError(!ok))}
          />
        ) : null}
        {reminderError ? <Body tone="error">{t("card.reminders.denied")}</Body> : null}

        {lockStore.available ? (
          <>
            <Body muted>{t(lock.status === "off" ? "settings.lock.off" : "settings.lock.on")}</Body>
            {lock.status === "off" && !settingPin ? (
              <Button
                label={t("settings.lock.enable")}
                variant="plain"
                onPress={() => setSettingPin(true)}
              />
            ) : null}
            {settingPin ? (
              <PinSetup submitLabel={t("settings.lock.save")} onDone={() => setSettingPin(false)} />
            ) : null}
            {lock.status === "unlocked" ? (
              <Button
                label={t("settings.lock.disable")}
                variant="plain"
                onPress={() => void lock.disable()}
              />
            ) : null}
          </>
        ) : null}

        {database.status === "ready" ? (
          <>
            <Body muted>{syncLine}</Body>
            <Button label={t("sync.now")} variant="plain" busy={sync.syncing} onPress={sync.sync} />
          </>
        ) : null}
        {database.status === "ready" ? (
          <Button
            label={t("backup.manage")}
            variant="plain"
            onPress={() => router.push("/backup")}
          />
        ) : null}
        {database.status === "ready" ? (
          <Button
            label={t("import.manage")}
            variant="plain"
            onPress={() => router.push("/import")}
          />
        ) : null}
        {database.status === "ready" ? (
          <Button
            label={t("recurring.manage")}
            variant="plain"
            onPress={() => router.push("/recurring")}
          />
        ) : null}
        {database.status === "ready" ? (
          <Button
            label={t("categories.manage")}
            variant="plain"
            onPress={() => router.push("/categories")}
          />
        ) : null}
        {database.status === "ready" ? (
          <Button
            label={t("settings.sample.remove")}
            variant="plain"
            onPress={() => void removeSampleData(database.db)}
          />
        ) : null}

        <Button
          label={t("settings.signOut")}
          busy={busy}
          onPress={() => {
            setBusy(true);
            void signOut();
          }}
        />
        <Body muted>
          {t("settings.version", { version: Constants.expoConfig?.version ?? "?" })}
        </Body>
      </ScrollView>
    </Screen>
  );
}
