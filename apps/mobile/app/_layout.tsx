import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "../src/auth/session";
import { LocalDatabaseProvider } from "../src/data/provider";
import { I18nProvider } from "../src/i18n/i18n";
import { ThemeProvider } from "../src/theme/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <I18nProvider>
          <SessionProvider>
            <LocalDatabaseProvider>
              <StatusBar style="auto" />
              <Stack screenOptions={{ headerShown: false }} />
            </LocalDatabaseProvider>
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
