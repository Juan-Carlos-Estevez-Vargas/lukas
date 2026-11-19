import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Body, Button, Field, Screen, Title } from "../components/ui";
import { useI18n } from "../i18n/i18n";
import { useTheme } from "../theme/theme";
import { useAppLock } from "./app-lock";

/**
 * Se dibuja encima de toda la app. Mientras la app está bloqueada o en el selector de apps,
 * nada de lo que hay debajo se ve.
 */
export function LockGate() {
  const lock = useAppLock();
  const { colors } = useTheme();
  if (lock.status === "locked") {
    return (
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}>
        <LockScreen />
      </View>
    );
  }
  if (lock.covered && lock.status === "unlocked") {
    return <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />;
  }
  return null;
}

function LockScreen() {
  const { t } = useI18n();
  const lock = useAppLock();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const biometric = async () => {
    await lock.unlockWithBiometrics(t("lock.biometricPrompt"), t("lock.cancel"));
  };

  // Ofrece la huella apenas aparece la pantalla, si el usuario la activó.
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo al montar.
  useEffect(() => {
    if (lock.biometric) void biometric();
  }, []);

  const submit = async () => {
    setBusy(true);
    const result = await lock.unlockWithPin(pin);
    setBusy(false);
    setPin("");
    if (result.ok) return;
    const seconds = Math.ceil(result.waitMs / 1000);
    setError(seconds > 0 ? t("lock.wait", { seconds }) : t("lock.wrong"));
  };

  return (
    <Screen>
      <Title>{t("lock.title")}</Title>
      <Field
        label={t("lock.enterPin")}
        value={pin}
        onChangeText={(v) => setPin(v.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        secureTextEntry
        autoComplete="off"
        autoFocus={!lock.biometric}
        maxLength={6}
        onSubmitEditing={() => void submit()}
      />
      {error ? <Body tone="error">{error}</Body> : null}
      <Button label={t("lock.unlock")} busy={busy} onPress={() => void submit()} />
      {lock.biometric ? (
        <Button label={t("lock.useBiometric")} variant="plain" onPress={() => void biometric()} />
      ) : null}
    </Screen>
  );
}
