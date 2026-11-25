import { FEEDBACK_KINDS, FEEDBACK_MAX_LENGTH, type FeedbackKind } from "@lukas/domain";
import Constants from "expo-constants";
import { useMemo, useState } from "react";
import { Platform, ScrollView } from "react-native";
import { useSession } from "../../src/auth/session";
import { Body, Button, Choice, Field, Screen, Title } from "../../src/components/ui";
import { apiUrl, e2eMode } from "../../src/config";
import {
  appVersionOf,
  createFeedbackClient,
  type FeedbackError,
  type FeedbackPlatform,
} from "../../src/feedback/client";
import type { MessageKey } from "../../src/i18n/es";
import { useI18n } from "../../src/i18n/i18n";
import { useTelemetry } from "../../src/telemetry/use-telemetry";
import { useTheme } from "../../src/theme/theme";

const ERRORS: Record<FeedbackError, MessageKey> = {
  length: "feedback.error.length",
  signed_out: "assistant.error.signedOut",
  rate_limited: "feedback.error.rateLimited",
  unavailable: "assistant.error.unavailable",
  network: "assistant.error.network",
  unexpected: "assistant.error.unexpected",
};

const platform: FeedbackPlatform =
  Platform.OS === "ios" ? "ios" : Platform.OS === "web" ? "web" : "android";

/** Comentarios de la beta (FIN-408): tipo, mensaje y listo. */
export default function Feedback() {
  const { t } = useI18n();
  const { space } = useTheme();
  const telemetry = useTelemetry();
  const { state: session } = useSession();
  const client = useMemo(
    () =>
      createFeedbackClient(apiUrl, {
        appVersion: appVersionOf(Constants.expoConfig?.version),
        platform,
      }),
    [],
  );
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const token = session.status === "signedIn" && !e2eMode ? session.token : null;

  const send = async () => {
    if (busy) return;
    setSent(false);
    setError(null);
    // En la build de e2e no hay API: se da por enviado para probar el flujo.
    if (e2eMode) {
      setMessage("");
      return setSent(true);
    }
    if (!token) return setError("feedback.signedOut");
    setBusy(true);
    const res = await client.send(token, { kind, message });
    setBusy(false);
    if (!res.ok) return setError(ERRORS[res.error]);
    setMessage("");
    setSent(true);
    telemetry.track("feedback_sent", { kind });
  };

  return (
    <Screen>
      <Title>{t("feedback.title")}</Title>
      <ScrollView contentContainerStyle={{ gap: space.md }} keyboardShouldPersistTaps="handled">
        <Body>{t("feedback.intro")}</Body>
        {FEEDBACK_KINDS.map((k) => (
          <Choice
            key={k}
            label={t(`feedback.kind.${k}`)}
            selected={kind === k}
            onPress={() => setKind(k)}
          />
        ))}
        <Field
          label={t("feedback.message")}
          value={message}
          onChangeText={setMessage}
          multiline
          maxLength={FEEDBACK_MAX_LENGTH}
          textAlignVertical="top"
          style={{ minHeight: 140 }}
          testID="feedback-message"
        />
        <Body muted>{t("feedback.privacy")}</Body>
        <Button label={t("feedback.send")} busy={busy} onPress={() => void send()} />
        {sent ? <Body>{t("feedback.sent")}</Body> : null}
        {error ? <Body tone="error">{t(error)}</Body> : null}
      </ScrollView>
    </Screen>
  );
}
