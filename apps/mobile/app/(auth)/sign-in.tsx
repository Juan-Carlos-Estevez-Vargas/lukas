import { useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";
import { type AuthError, isSixDigitCode, looksLikeEmail } from "../../src/api/auth-client";
import { useSession } from "../../src/auth/session";
import { Body, Button, Field, Screen, Title } from "../../src/components/ui";
import { useI18n } from "../../src/i18n/i18n";
import type { Translate } from "../../src/i18n/translator";

const describe = (t: Translate, error: AuthError): string => {
  switch (error.kind) {
    case "invalid":
      return t("signIn.invalidCode");
    case "rate_limited":
      return t("signIn.tooMany", { seconds: error.retryAfterSeconds });
    default:
      return t("signIn.network");
  }
};

/** Acceso sin contraseña: correo → código de 6 dígitos. */
export default function SignIn() {
  const { t } = useI18n();
  const { client, signIn } = useSession();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    const address = email.trim().toLowerCase();
    if (!looksLikeEmail(address)) return setError(t("signIn.invalidEmail"));
    setBusy(true);
    setError(null);
    const result = await client.sendCode(address);
    setBusy(false);
    if (!result.ok) return setError(describe(t, result.error));
    setEmail(address);
    setStep("code");
  };

  const verify = async () => {
    if (!isSixDigitCode(code)) return setError(t("signIn.invalidCode"));
    setBusy(true);
    setError(null);
    const result = await client.verifyCode(email, code);
    if (!result.ok) {
      setBusy(false);
      return setError(describe(t, result.error));
    }
    await signIn(result.value);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen>
        <Title>{t("signIn.title")}</Title>
        {step === "email" ? (
          <>
            <Body muted>{t("signIn.subtitle")}</Body>
            <Field
              label={t("signIn.email")}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="send"
              onSubmitEditing={sendCode}
            />
            {error ? <Body tone="error">{error}</Body> : null}
            <Button label={t("signIn.sendCode")} onPress={sendCode} busy={busy} />
          </>
        ) : (
          <>
            <Body muted>{t("signIn.codeSentTo", { email })}</Body>
            <Field
              label={t("signIn.code")}
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
              autoComplete="one-time-code"
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              maxLength={6}
              returnKeyType="done"
              onSubmitEditing={verify}
            />
            {error ? <Body tone="error">{error}</Body> : null}
            <Button label={t("signIn.verify")} onPress={verify} busy={busy} />
            <Button
              variant="plain"
              label={t("signIn.changeEmail")}
              onPress={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
            />
          </>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}
