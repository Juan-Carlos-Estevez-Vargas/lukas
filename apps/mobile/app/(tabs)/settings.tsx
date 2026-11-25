import Constants from "expo-constants";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView } from "react-native";
import { assistantEnabled, setAssistantEnabled } from "../../src/assistant/settings";
import { useSession } from "../../src/auth/session";
import { forgetEntitlements } from "../../src/billing/entitlements";
import { useEntitlements } from "../../src/billing/use-entitlements";
import { notificationReader } from "../../src/capture/reader";
import { Body, Button, Screen, Title, Toggle } from "../../src/components/ui";
import { apiUrl, e2eMode } from "../../src/config";
import { useLocalDatabase } from "../../src/data/provider";
import { useDiscreet } from "../../src/display/discreet";
import { useI18n } from "../../src/i18n/i18n";
import { useAppLock } from "../../src/lock/app-lock";
import { lockStore } from "../../src/lock/lock-store";
import { PinSetup } from "../../src/lock/pin-setup";
import { pushTokenSource } from "../../src/notifications/push-token";
import {
  createDeviceClient,
  forgetDevice,
  setWeeklySummary,
  type WeeklyResult,
  weeklyEnabled,
} from "../../src/notifications/weekly";
import { removeSampleData } from "../../src/onboarding/onboarding";
import { useCardReminders } from "../../src/reminders/use-card-reminders";
import { useDeviceSecurity } from "../../src/security/use-device-security";
import { syncLine as describeSync } from "../../src/sync/text";
import { useSync } from "../../src/sync/use-sync";
import { useTelemetry } from "../../src/telemetry/use-telemetry";

const devices = createDeviceClient(apiUrl);

export default function Settings() {
  const { t, locale } = useI18n();
  const { signOut, state: session } = useSession();
  const security = useDeviceSecurity();
  const telemetry = useTelemetry();
  const { entitlements } = useEntitlements();
  const sync = useSync();
  const syncLine = describeSync(t, locale, sync);
  const { discreet, setDiscreet } = useDiscreet();
  const lock = useAppLock();
  const database = useLocalDatabase();
  const [busy, setBusy] = useState(false);
  const [settingPin, setSettingPin] = useState(false);
  const reminders = useCardReminders();
  const [reminderError, setReminderError] = useState(false);
  const [assistant, setAssistant] = useState(false);
  const [weekly, setWeekly] = useState(false);
  const [weeklyBusy, setWeeklyBusy] = useState(false);
  const [weeklyNote, setWeeklyNote] = useState<WeeklyResult | null>(null);
  const db = database.status === "ready" ? database.db : null;

  useFocusEffect(
    useCallback(() => {
      if (!db) return;
      void assistantEnabled(db).then(setAssistant);
      void weeklyEnabled(db).then(setWeekly);
    }, [db]),
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 16 }} keyboardShouldPersistTaps="handled">
        <Title>{t("tabs.settings")}</Title>
        <Toggle label={t("settings.discreet")} value={discreet} onChange={setDiscreet} />
        {security.available ? (
          <Toggle
            label={t("security.screenshots")}
            value={security.screenshotsAllowed}
            onChange={security.setScreenshotsAllowed}
          />
        ) : null}
        {db && !e2eMode ? (
          <>
            <Toggle
              label={t("telemetry.setting")}
              value={telemetry.enabled}
              onChange={telemetry.setEnabled}
            />
            <Body muted>{t("telemetry.help")}</Body>
          </>
        ) : null}
        {db ? (
          <Toggle
            label={t("assistant.setting")}
            value={assistant}
            onChange={(on) => {
              // Encenderlo pasa por la explicación de qué datos usa; apagarlo es inmediato.
              if (on) {
                router.push("/assistant");
                return;
              }
              setAssistant(false);
              void setAssistantEnabled(db, false);
            }}
          />
        ) : null}
        {db && pushTokenSource.available && session.status === "signedIn" ? (
          <Toggle
            label={t("notifications.weekly")}
            value={weekly}
            onChange={(on) => {
              if (weeklyBusy) return;
              setWeeklyBusy(true);
              setWeeklyNote(null);
              void setWeeklySummary(
                db,
                { source: pushTokenSource, client: devices, session: session.token },
                on,
              )
                .then((result) => {
                  if (result === "on" || result === "off") setWeekly(result === "on");
                  else setWeeklyNote(result);
                })
                .finally(() => setWeeklyBusy(false));
            }}
          />
        ) : null}
        {weeklyNote ? (
          <Body tone="error">
            {t(weeklyNote === "denied" ? "notifications.denied" : "notifications.offline")}
          </Body>
        ) : null}
        {db && assistant ? (
          <Button
            label={t("assistant.open")}
            variant="plain"
            onPress={() => router.push("/assistant")}
          />
        ) : null}
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
        {database.status === "ready" && notificationReader ? (
          <Button
            label={t("capture.manage")}
            variant="plain"
            onPress={() => router.push("/capture")}
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
            // Que el teléfono no siga recibiendo resúmenes de esta cuenta.
            const forget =
              db && session.status === "signedIn"
                ? Promise.all([
                    forgetDevice(db, devices, session.token).catch(() => undefined),
                    forgetEntitlements(db).catch(() => undefined),
                  ])
                : Promise.resolve();
            void forget.then(() => signOut());
          }}
        />
        <Body muted>{t("settings.plan", { plan: t(`plan.${entitlements.plan}`) })}</Body>
        <Button
          label={t("settings.plans")}
          variant="plain"
          onPress={() => router.push("/premium")}
        />
        <Button
          label={t("settings.feedback")}
          variant="plain"
          onPress={() => router.push("/feedback")}
        />
        <Button
          label={t("settings.deleteAccount")}
          variant="plain"
          onPress={() => router.push("/account/delete")}
        />
        <Body muted>
          {t("settings.version", { version: Constants.expoConfig?.version ?? "?" })}
        </Body>
      </ScrollView>
    </Screen>
  );
}
