import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "../src/auth/session";
import { LocalDatabaseProvider } from "../src/data/provider";
import { DiscreetProvider } from "../src/display/discreet";
import { I18nProvider } from "../src/i18n/i18n";
import { AppLockProvider } from "../src/lock/app-lock";
import { LockGate } from "../src/lock/lock-screen";
import { OnboardingProvider } from "../src/onboarding/use-onboarding";
import { CardRemindersProvider } from "../src/reminders/use-card-reminders";
import { ThemeProvider } from "../src/theme/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <I18nProvider>
          <SessionProvider>
            <LocalDatabaseProvider>
              <OnboardingProvider>
                <DiscreetProvider>
                  <CardRemindersProvider>
                    <AppLockProvider>
                      <StatusBar style="auto" />
                      <Stack screenOptions={{ headerShown: false }} />
                      <LockGate />
                    </AppLockProvider>
                  </CardRemindersProvider>
                </DiscreetProvider>
              </OnboardingProvider>
            </LocalDatabaseProvider>
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
