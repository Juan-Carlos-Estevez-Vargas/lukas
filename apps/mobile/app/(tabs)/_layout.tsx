import { Redirect, Tabs } from "expo-router";
import { useSession } from "../../src/auth/session";
import { Loading } from "../../src/components/ui";
import { useI18n } from "../../src/i18n/i18n";
import { useOnboarding } from "../../src/onboarding/use-onboarding";
import { useTheme } from "../../src/theme/theme";

export default function TabsLayout() {
  const { state } = useSession();
  const onboarding = useOnboarding();
  const { t } = useI18n();
  const { colors } = useTheme();
  if (state.status === "loading") return <Loading />;
  if (state.status === "signedOut") return <Redirect href="/(auth)/sign-in" />;
  if (onboarding.status === "checking") return <Loading />;
  if (onboarding.status === "pending") return <Redirect href="/(onboarding)/welcome" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t("tabs.summary") }} />
      <Tabs.Screen name="transactions" options={{ title: t("tabs.transactions") }} />
      <Tabs.Screen name="budgets" options={{ title: t("tabs.budgets") }} />
      <Tabs.Screen name="settings" options={{ title: t("tabs.settings") }} />
    </Tabs>
  );
}
