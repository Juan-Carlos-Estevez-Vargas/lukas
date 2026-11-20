import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "../src/auth/session";
import { EntitlementsProvider } from "../src/billing/use-entitlements";
import { BudgetAlertsProvider } from "../src/budgets/use-budget-alerts";
import { CaptureProvider } from "../src/capture/use-capture";
import { LocalDatabaseProvider } from "../src/data/provider";
import { DiscreetProvider } from "../src/display/discreet";
import { I18nProvider } from "../src/i18n/i18n";
import { AppLockProvider } from "../src/lock/app-lock";
import { LockGate } from "../src/lock/lock-screen";
import { usePushLinks } from "../src/notifications/use-push-links";
import { OnboardingProvider } from "../src/onboarding/use-onboarding";
import { RecurringProvider } from "../src/recurring/use-recurring";
import { CardRemindersProvider } from "../src/reminders/use-card-reminders";
import { SyncProvider } from "../src/sync/use-sync";
import { ThemeProvider } from "../src/theme/theme";

export default function RootLayout() {
  usePushLinks();
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <I18nProvider>
          <SessionProvider>
            <LocalDatabaseProvider>
              <SyncProvider>
                <EntitlementsProvider>
                  <OnboardingProvider>
                    <CaptureProvider>
                      <DiscreetProvider>
                        <CardRemindersProvider>
                          <BudgetAlertsProvider>
                            <RecurringProvider>
                              <AppLockProvider>
                                <StatusBar style="auto" />
                                <Stack screenOptions={{ headerShown: false }} />
                                <LockGate />
                              </AppLockProvider>
                            </RecurringProvider>
                          </BudgetAlertsProvider>
                        </CardRemindersProvider>
                      </DiscreetProvider>
                    </CaptureProvider>
                  </OnboardingProvider>
                </EntitlementsProvider>
              </SyncProvider>
            </LocalDatabaseProvider>
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
