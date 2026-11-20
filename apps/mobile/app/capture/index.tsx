import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AppState, ScrollView, Text, View } from "react-native";
import { CAPTURE_APPS } from "../../src/capture/apps";
import { notificationReader as reader } from "../../src/capture/reader";
import { Body, Button, Screen, Title, Toggle } from "../../src/components/ui";
import { useI18n } from "../../src/i18n/i18n";
import { useTheme } from "../../src/theme/theme";

const POINTS = [
  "capture.point.apps",
  "capture.point.device",
  "capture.point.review",
  "capture.point.revoke",
] as const;

/** Consentimiento y ajustes del lector de notificaciones (solo Android). */
export default function CaptureSettings() {
  const { t } = useI18n();
  const { colors, space, fontSize } = useTheme();
  const [access, setAccess] = useState(false);
  const [allowed, setAllowed] = useState<readonly string[]>([]);

  const refresh = useCallback(() => {
    if (!reader) return;
    setAccess(reader.hasAccess());
    setAllowed(reader.allowedApps());
  }, []);

  useFocusEffect(refresh);
  // Al volver de los ajustes de Android el permiso pudo cambiar.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const toggle = (app: string, on: boolean) => {
    if (!reader) return;
    const next = on ? [...allowed, app] : allowed.filter((a) => a !== app);
    reader.setAllowedApps(next);
    setAllowed(next);
  };

  return (
    <Screen>
      <Title>{t("capture.title")}</Title>
      <ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: space.xl }}>
        <Body>{t("capture.intro")}</Body>
        <View style={{ gap: space.sm }}>
          {POINTS.map((key) => (
            <Text key={key} style={{ color: colors.text, fontSize: fontSize.body }}>
              {`•  ${t(key)}`}
            </Text>
          ))}
        </View>
        {reader ? (
          <>
            <Body muted>{t(access ? "capture.access.on" : "capture.access.off")}</Body>
            <Button
              label={t(access ? "capture.access.manage" : "capture.access.grant")}
              variant={access ? "plain" : "primary"}
              onPress={() => reader?.openSettings()}
            />
            <Body muted>{t("capture.apps")}</Body>
            {CAPTURE_APPS.map((a) => (
              <Toggle
                key={a.app}
                label={a.name}
                value={allowed.includes(a.app)}
                onChange={(on) => toggle(a.app, on)}
              />
            ))}
            {access && allowed.length > 0 ? (
              <Button
                label={t("inbox.title")}
                variant="plain"
                onPress={() => router.push("/inbox")}
              />
            ) : null}
          </>
        ) : (
          <Body muted>{t("capture.unsupported")}</Body>
        )}
      </ScrollView>
    </Screen>
  );
}
