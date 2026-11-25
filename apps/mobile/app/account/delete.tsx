import { router } from "expo-router";
import { useState } from "react";
import { ScrollView } from "react-native";
import { wipeLocalData } from "../../src/account/wipe";
import { useSession } from "../../src/auth/session";
import { Body, Button, Field, Screen, Title } from "../../src/components/ui";
import { useLocalDatabase } from "../../src/data/provider";
import type { MessageKey } from "../../src/i18n/es";
import { useI18n } from "../../src/i18n/i18n";
import { receiptStore } from "../../src/receipts/receipt-store";
import { useTheme } from "../../src/theme/theme";

/**
 * Borrar la cuenta (Ley 1581 y Google Play): la API borra a la persona y, en cascada, todos sus
 * datos; después se deja el teléfono como recién instalado y se cierra la sesión.
 */
export default function DeleteAccount() {
  const { t } = useI18n();
  const { space } = useTheme();
  const { state: session, client, signOut } = useSession();
  const database = useLocalDatabase();
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const confirmed = word.trim().toUpperCase() === t("deleteAccount.word");

  const remove = async () => {
    if (busy || !confirmed) return;
    if (session.status !== "signedIn") return setError("deleteAccount.signedOut");
    setError(null);
    setBusy(true);
    const res = await client.deleteAccount(session.token);
    if (!res.ok) {
      setBusy(false);
      return setError(res.error.kind === "invalid" ? "deleteAccount.stale" : "deleteAccount.error");
    }
    if (database.status === "ready") {
      await wipeLocalData(database.db, (name) => receiptStore.remove(name)).catch(() => undefined);
    }
    await signOut().catch(() => undefined);
    router.replace("/");
  };

  return (
    <Screen>
      <Title>{t("deleteAccount.title")}</Title>
      <ScrollView contentContainerStyle={{ gap: space.md }} keyboardShouldPersistTaps="handled">
        <Body>{t("deleteAccount.intro")}</Body>
        <Body muted>{t("deleteAccount.backup")}</Body>
        <Button label={t("backup.manage")} variant="plain" onPress={() => router.push("/backup")} />
        <Body muted>{t("deleteAccount.subscription")}</Body>
        <Field
          label={t("deleteAccount.confirm")}
          value={word}
          onChangeText={setWord}
          autoCapitalize="characters"
          autoCorrect={false}
          testID="delete-account-word"
        />
        {confirmed ? (
          <Button label={t("deleteAccount.submit")} busy={busy} onPress={() => void remove()} />
        ) : null}
        {error ? <Body tone="error">{t(error)}</Body> : null}
        {error === "deleteAccount.stale" ? (
          <Button label={t("settings.signOut")} variant="plain" onPress={() => void signOut()} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}
