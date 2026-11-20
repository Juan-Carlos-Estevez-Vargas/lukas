import { Redirect, Tabs } from "expo-router";
import { useWindowDimensions } from "react-native";
import { useSession } from "../../src/auth/session";
import { Body, Button, Loading, Screen, Title } from "../../src/components/ui";
import { isDesktop } from "../../src/display/layout";
import { useI18n } from "../../src/i18n/i18n";
import { useOnboarding } from "../../src/onboarding/use-onboarding";
import { useSync } from "../../src/sync/use-sync";
import { useTheme } from "../../src/theme/theme";

export default function TabsLayout() {
  const { state } = useSession();
  const onboarding = useOnboarding();
  const { t } = useI18n();
  const { colors } = useTheme();
  const { sync, syncing } = useSync();
  const { width } = useWindowDimensions();
  const desktop = isDesktop(width);
  if (state.status === "loading") return <Loading />;
  if (state.status === "signedOut") return <Redirect href="/(auth)/sign-in" />;
  if (onboarding.status === "checking") return <Loading />;
  if (onboarding.status === "pending") return <Redirect href="/(onboarding)/welcome" />;
  if (onboarding.status === "offline") {
    return (
      <Screen>
        <Title>{t("web.offlineTitle")}</Title>
        <Body muted>{t("web.offlineBody")}</Body>
        <Button label={t("web.retry")} onPress={sync} busy={syncing} />
      </Screen>
    );
  }
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        // En escritorio el menú va a la izquierda, como en cualquier app web de finanzas.
        tabBarPosition: desktop ? "left" : "bottom",
        tabBarVariant: desktop ? "material" : "uikit",
        tabBarLabelPosition: desktop ? "beside-icon" : "below-icon",
        tabBarStyle: desktop
          ? { backgroundColor: colors.surface, borderRightColor: colors.border, minWidth: 200 }
          : { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t("tabs.summary") }} />
      <Tabs.Screen name="transactions" options={{ title: t("tabs.transactions") }} />
      <Tabs.Screen name="reports" options={{ title: t("tabs.reports") }} />
      <Tabs.Screen name="budgets" options={{ title: t("tabs.budgets") }} />
      <Tabs.Screen name="settings" options={{ title: t("tabs.settings") }} />
    </Tabs>
  );
}
