import { useState } from "react";
import { Body, Button, Field, Toggle } from "../components/ui";
import type { MessageKey } from "../i18n/es";
import { useI18n } from "../i18n/i18n";
import { useAppLock } from "./app-lock";
import { checkPin } from "./pin";

/** Pide el PIN dos veces y, si el teléfono la tiene, ofrece huella o rostro. */
export function PinSetup({
  submitLabel,
  onDone,
}: {
  readonly submitLabel: string;
  readonly onDone: () => void;
}) {
  const { t } = useI18n();
  const lock = useAppLock();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [biometric, setBiometric] = useState(lock.biometricsAvailable);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const problem = checkPin(pin);
    if (problem) return setError(t(`lock.pin.${problem}` as MessageKey));
    if (pin !== confirm) return setError(t("lock.pinMismatch"));
    setBusy(true);
    try {
      await lock.enable(pin, biometric && lock.biometricsAvailable);
      onDone();
    } catch {
      setError(t("onboarding.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Field
        label={t("lock.pin")}
        value={pin}
        onChangeText={(v) => setPin(v.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        secureTextEntry
        autoComplete="off"
        maxLength={6}
      />
      <Field
        label={t("lock.pinConfirm")}
        value={confirm}
        onChangeText={(v) => setConfirm(v.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        secureTextEntry
        autoComplete="off"
        maxLength={6}
      />
      {lock.biometricsAvailable ? (
        <Toggle label={t("lock.biometric")} value={biometric} onChange={setBiometric} />
      ) : null}
      {error ? <Body tone="error">{error}</Body> : null}
      <Button label={submitLabel} busy={busy} onPress={() => void save()} />
    </>
  );
}
